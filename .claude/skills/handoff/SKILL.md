---
name: handoff
description: |
  Save / restore / show / list cross-session handoffs. Captures git state, decisions,
  working set, open loops + generates a copy-paste resume prompt. Symmetric restore/show:
  a fresh session runs /handoff restore to load a read-only receipt, or /handoff show
  to print that receipt plus the full body without a prompt.
  Triggers on "handoff", "save and switch", "new session", "pick up later",
  "prepare handoff", "save progress for next session", "resume", "where was I",
  "restore context", "show handoff", "list handoffs", "what handoffs do I have".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# /handoff — Cross-Session Handoff (v2)

Manage handoffs with four subcommands: `save`, `restore`, `show`, `list`.

**HARD GATE (applies to all subcommands):** This skill NEVER modifies code or arbitrary files. It writes ONLY: (1) new handoff files in the memory dir, (2) MEMORY.md index entries, (3) SYNC.md coordination entries when relevant, (4) `status:` field updates on superseded prior handoffs (metadata-only frontmatter mutation), (5) restore-time `last_verified_at:` field writes on the selected handoff (metadata-only frontmatter mutation), (6) append-only `### Event Log` body writes on handoff files for lifecycle audit events during SAVE, RESTORE, supersession, and explicit shipped/abandoned status marking. Explicit `/handoff save --stash` (or an explicit save-time `stash` keyword) is the only opt-in git mutation this skill may perform: when requested, SAVE may run `git stash push -u -m "handoff_<handoff_id>"` after capturing the dirty-tree capsule and before confirmation. This is a save-time side effect, not a restore-time action; it is never automatic, and restore/show only print a paste-ready `git stash pop "$(git stash list | grep 'handoff_<handoff_id>' | head -1 | cut -d: -f1)"` cue. Restore never executes the handoff: restoring a handoff with `first_action: edit X.py` prints that line as a paste-ready prompt for the user's NEXT turn — it does NOT execute it inside the skill invocation. The only restore writes are the `last_verified_at:` frontmatter write after the staleness probe plus one append-only `restored` Event Log line; show is strictly read-only. Show prints the restore receipt plus the full saved body without AskUserQuestion, and does not write frontmatter fields or Event Log lines.

## Subcommand routing

Parse the user's input in this priority order. Stop at the first match.

### 1. Explicit subcommand keyword

- `/handoff save [--stash] [--delta|--full] [<title>]` → **save**
- `/handoff restore [<id|n|fragment>]` → **restore**
- `/handoff show [<id|n|fragment>]` → **show**
- `/handoff list [--all]` → **list**

For SAVE only, `--stash` sets `STASH_REQUESTED=true`; `--delta` sets `DELTA_REQUESTED=true`; `--full` sets `FULL_REQUESTED=true`. Strip all recognized flags from the title before title inference. Defaults are `STASH_REQUESTED=false`, `DELTA_REQUESTED=false`, and `FULL_REQUESTED=false`; there is no `--no-stash`. If both `--delta` and `--full` are present, abort before Step 1 with a clear error because they are mutually exclusive.

**Exception (codex review P3 fold):** `/handoff show handoffs` (plural noun, no other args) routes to **list**, NOT show. Check this before treating `handoffs` as a fragment selector. The multi-word list trigger takes precedence over the `show + arg` shape so that the legacy v2.0 phrase remains valid.

### 2. Natural-language trigger phrase (read-only intent gets read-only flow)

When the args (or the user's surrounding message) match a restore/show/list trigger, route to that flow BEFORE the save-with-title fallback. A "resume" or "show" intent must NOT silently execute save and write a new handoff/MEMORY/SYNC entry.

Evaluate exact multi-word triggers before bare `show`, so `show handoffs` remains list while `show handoff` routes show.

- Restore triggers: `resume`, `where was i`, `pick up where i left off`, `restore context`, `resume context`, `resume work`, `continue session`
- Show triggers: `show`, `show handoff`, `handoff show`
- List triggers: `list handoffs`, `what handoffs do i have`, `show handoffs`, `handoff list`

Match case-insensitively against the first few words of args (or the user message if args are empty).

Save-only modifiers: after routing resolves to SAVE, treat the explicit args `stash`, `with stash`, or `and stash` as `STASH_REQUESTED=true` and strip those words from the title before title inference. Delta/full mode is controlled only by exact flags `--delta` and `--full`; do not infer it from natural-language words. These modifiers do not override restore/show/list trigger matches. Do not ask an AskUserQuestion for stash capture or delta/full capture; the flag/default auto-detect surface is the entire opt-in surface.

### 3. Save defaults

- `/handoff` (no args) → **save**, infer title from conversation
- `/handoff <title>` (first arg not a keyword, not a restore/list trigger) → **save** with the given title

---

## SAVE flow

### Step 1: Pre-flight probe (bash, all fail-open)

```bash
# STASH_REQUESTED is set by Subcommand routing for `/handoff save --stash`,
# `stash`, `with stash`, or `and stash`. Default is no stash.
: "${STASH_REQUESTED:=false}"
STASH_REF=null
STASH_NOTE=null

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "ERROR: not in a git repo"; exit 2; }
BRANCH=$(git branch --show-current 2>/dev/null || echo unknown)
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
BASE_COMMIT=$(git rev-parse --short "$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD)" 2>/dev/null || echo unknown)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo null)
# Keep porcelain output in a bash variable, not a temp file. Avoids /tmp clobber
# under concurrent /handoff save invocations and keeps the skill's writes scoped
# to memory dir + MEMORY.md + SYNC.md per the HARD GATE.
STATUS_OUT=$(git status --porcelain=v2 --branch 2>/dev/null)
DIRTY_FILES=$(echo "$STATUS_OUT" | awk '/^[12u?] /{print $NF}' | head -50)
[ -n "$DIRTY_FILES" ] && DIRTY=true || DIRTY=false
# Use `git diff HEAD` (not bare `git diff`) so the Dirty Tree section captures
# BOTH staged AND unstaged hunks. Bare `git diff` only shows unstaged — a fully
# staged dirty tree would render as empty diff in the saved handoff.
DIFF_STAT=$(git diff HEAD --stat 2>/dev/null | tail -30)
DIFF_NAMES=$(git diff HEAD --name-status 2>/dev/null | head -50)
WORKTREES=$(git worktree list --porcelain 2>/dev/null)
WORKTREE_COUNT=$(echo "$WORKTREES" | awk '/^worktree /' | wc -l | tr -d ' ')
# Detect sibling-worktree mode (git-common-dir != .git means we're in a worktree, not main repo).
# IS_WORKTREE is what callers actually need; the actual checkout root is REPO_ROOT (above).
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
[ "$COMMON_DIR" = ".git" ] && IS_WORKTREE=false || IS_WORKTREE=true
# Session color: per project CLAUDE.md, Codex-Claude sessions use the
# codex-claude-session helper; other Claude sessions read .claude/session-color
# (the worktree default). Disambiguate via $CLAUDE_CODE_SESSION_ID — set by
# Claude Code itself, absent in pure Codex sessions. (The helper alone is not
# a disambiguator: it auto-creates a codex-<id> label even when called from
# Claude Code, so its presence cannot prove Codex context.)
if [ -n "$CLAUDE_CODE_SESSION_ID" ] || [ -n "$CLAUDECODE" ]; then
  SESSION_COLOR=$(cat "$REPO_ROOT/.claude/session-color" 2>/dev/null || echo null)
  SOURCE_SESSION=claude
else
  SESSION_COLOR=$(/Users/will/.local/bin/codex-claude-session --root "$REPO_ROOT" 2>/dev/null | sed -n 's/^Color: //p')
  SOURCE_SESSION=codex-claude
fi
[ -z "$SESSION_COLOR" ] && SESSION_COLOR=null
# Fail-open gh pr list. Two concerns this code handles:
#  (a) Default `gh pr list` queries the upstream-tracked remote, which on a fork
#      (e.g. flusterff/nanoclaw) misses PRs you actually care about (per project
#      HARD RULE feedback_never_pr_to_upstream_nanoclaw). Derive --repo from
#      origin URL.
#  (b) Distinguish three outcomes — "gh succeeded, no PRs" vs "gh succeeded with
#      PRs" vs "gh ran but failed (transient/parse/offline)". A silent failure
#      that looks like "no PRs" misleads the staleness probe at restore time.
GH_REPO=$(git config --get remote.origin.url 2>/dev/null | sed -E 's|.*[:/]([^/]+/[^/.]+)(\.git)?$|\1|')
if ! command -v gh >/dev/null 2>&1; then
  OPEN_PRS=""; PR_PROBE_NOTE="gh missing"
elif ! gh auth status >/dev/null 2>&1; then
  OPEN_PRS=""; PR_PROBE_NOTE="gh unauthenticated"
else
  GH_OUT=$(gh pr list --head "$BRANCH" --repo "$GH_REPO" --json number,url -q '.[] | "#\(.number)|\(.url)"' 2>&1)
  GH_EXIT=$?
  if [ "$GH_EXIT" -eq 0 ]; then
    OPEN_PRS=$(echo "$GH_OUT" | head -10)
    PR_PROBE_NOTE=null
  else
    OPEN_PRS=""
    # Truncate any multi-line error so frontmatter stays clean.
    PR_PROBE_NOTE="gh probe failed (exit ${GH_EXIT}): $(echo "$GH_OUT" | head -1 | cut -c1-80)"
  fi
fi
```

If `git rev-parse --show-toplevel` fails, abort with a clear error before writing anything.

### Step 2: One-question capture override (optional, single AUQ)

Skip this step entirely if:
- A title was provided in the user's invocation
- The user provided specific constraints in this turn
- Pre-flight detected rich body context (planned files, decisions in conversation)

Otherwise, ONE AskUserQuestion: "Anything the new session must preserve that I might miss?" with a free-text field plus a skip option. The answer may override synthesized fields, including Resume Commands; do not add a second question for resume-command capture. It must not set or unset stash behavior; stash is controlled only by the explicit `--stash` flag or save-time stash keywords. Cap friction at ~30s.

### Step 2.5: Decide delta vs full save mode

Delta mode is section-level only. It never writes line diffs or word diffs. It is enabled when:
- `--delta` was passed and an eligible same-`repo_root` + same-`branch` parent exists, regardless of age.
- OR default auto-detect finds an eligible parent saved less than 24 hours ago.
- `--full` was passed → force full save and skip parent lookup for delta purposes.

Eligible parent status is `in-progress` or `superseded` only. If `--delta` is explicit and no eligible parent exists, abort before writing anything and tell the user to rerun with `--full` for a full save. If auto-detect finds no eligible recent parent, continue as a full save.

```bash
# DELTA_REQUESTED and FULL_REQUESTED are set by Subcommand routing.
: "${DELTA_REQUESTED:=false}"
: "${FULL_REQUESTED:=false}"

HANDOFF_DIR=~/.claude/projects/-Users-will-nanoclaw/memory
DELTA_MODE=false
DELTA_PARENT_ID=""
DELTA_PARENT_FILE=""
DELTA_NOTE="full save"

delta_saved_age_seconds() {
  python3 -c 'from datetime import datetime, timezone
import os, sys
ts = os.environ.get("P_SAVED_AT", "").strip().strip("\"")
if not ts:
    sys.exit(1)
try:
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
except Exception:
    sys.exit(1)
print(int((datetime.now(timezone.utc) - dt).total_seconds()))' 2>/dev/null
}

find_delta_parent() {
  for f in $(find "$HANDOFF_DIR" -maxdepth 1 -name "handoff_*.md" -type f 2>/dev/null | sort -r); do
    P_REPO=$(sed -n 's/^  repo_root: //p' "$f" | head -1)
    P_BRANCH=$(sed -n 's/^  branch: //p' "$f" | head -1)
    P_STATUS=$(sed -n 's/^  status: //p' "$f" | head -1)
    P_ID=$(sed -n 's/^  handoff_id: //p' "$f" | head -1)
    P_SAVED_AT=$(sed -n 's/^  saved_at: //p' "$f" | head -1)

    [ "$P_REPO" = "$REPO_ROOT" ] || continue
    [ "$P_BRANCH" = "$BRANCH" ] || continue
    # Codex review P2 fold: if newest matching handoff is shipped/abandoned,
    # STOP — do NOT continue to older superseded handoffs (would silently
    # delta against stale completed work). Terminal newest match = no delta
    # parent eligible.
    case "$P_STATUS" in
      in-progress|superseded) ;;
      shipped|abandoned) return 1 ;;
      *) continue ;;
    esac
    [ -n "$P_ID" ] || continue

    # Auto-detect requires <24h. Explicit --delta ignores age but still
    # requires same repo+branch and an eligible status.
    if [ "$DELTA_REQUESTED" != true ]; then
      P_AGE_SECONDS=$(P_SAVED_AT="$P_SAVED_AT" delta_saved_age_seconds) || continue
      [ "$P_AGE_SECONDS" -ge 0 ] && [ "$P_AGE_SECONDS" -lt 86400 ] || continue
    fi

    DELTA_PARENT_ID="$P_ID"
    DELTA_PARENT_FILE="$f"
    return 0
  done
  return 1
}

if [ "$FULL_REQUESTED" = true ]; then
  DELTA_MODE=false
  DELTA_NOTE="full save requested via --full"
elif find_delta_parent; then
  DELTA_MODE=true
  DELTA_NOTE="delta save against parent_handoff=${DELTA_PARENT_ID}"
elif [ "$DELTA_REQUESTED" = true ]; then
  echo "ERROR: --delta requested but no same repo+branch parent handoff with status in-progress or superseded was found; rerun with --full for a full save."
  exit 2
else
  DELTA_MODE=false
  DELTA_NOTE="full save; no eligible <24h parent"
fi
```

When `DELTA_MODE=true`, Step 5 must write `parent_handoff: <DELTA_PARENT_ID>` in frontmatter. When `DELTA_MODE=false`, omit `parent_handoff` unless another feature intentionally records non-delta lineage.

### Step 3: Synthesize body sections from conversation context

Sections to include (omit any that are empty — never write empty headers, except `### Event Log` which is always present because SAVE writes the initial `created` event):

Delta save rule: synthesize the would-be full content for every section first, then compare each eligible section's synthesized content against the parent's same section content as raw strings. Do not normalize whitespace and do not compute line/word diffs. If the section is identical, write the section header and exactly one pointer line, with no other content under that header:

`<see parent_handoff: <parent-id> for unchanged <section-name>>`

Eligible for delta omission: `### Decisions Made`, `### Working Set`, `### Resume Commands`, `### Environment Hints`, `### Dirty Tree`, `### Worktree Map`.

Always write full: `### Summary`, `### Open Loops`, `### Event Log`, and the `## Working on: <title>` line. If the parent section is missing or unreadable at save time, write the new section content in full.

- `## Working on: <title>` + `### Summary` (1-3 sentences)
- `### Decisions Made` — bullets with "why" each
- `### Working Set`:
  - **Read-first:** ordered files+ranges (1-5 entries)
  - **Key symbols:** `file:line — function/class — why it matters` (max ~5)
  - **Do not touch:** files explicitly out of scope
- `### Resume Commands`:
  - Synthesize from conversation context at save time, plus the optional Step 2 override if provided.
  - Capture 3-7 ordered shell commands the user or future session would run to wake the work back up (`cd`, `git checkout`, dev server start, `gh pr view`, `tail -f`, etc.).
  - Write commands, not paragraphs, as one fenced `bash` block. Commands are paste-ready and are printed later; they are never auto-executed by restore/show.
  - Do not capture secrets or secret-bearing command lines. If a needed command would include token/key values, write a `# <secret-redacted>` placeholder line instead.
  - Omit the entire section if no actionable resume commands are inferable.
- `### Environment Hints`:
  - Capture at SAVE time only. Restore/show print saved body content; they do not recompute environment hints and never auto-restore environment.
  - Purpose: record runtime drift clues the work depended on: current `pwd`, project-used CLI versions and executable paths, and a tiny allowlisted env subset. This is body content, so frontmatter/YAML quoting rules do not apply.
  - Tool versions: capture only tools the project actually uses, determined by repo evidence: package manifests (`package.json`, `pyproject.toml`, `Cargo.toml`), repo `bin/` or script files, tracked repo text, or recent commit messages. Do not dump every installed tool on the machine.
  - Candidate tools are finite and explicit: `node`, `npm`, `pnpm`, `yarn`, `python`, `python3`, `pip`, `pip3`, `gh`, `codex`, `jq`, `docker`, `container`, `sqlite3`, `tsx`, `tsc`, `vitest`, `pytest`, `cargo`, `rustc`, `go`, `make`. Emit a tool only if repo evidence says it is used AND `command -v <tool>` succeeds.
  - Env allowlist, before the banlist: exactly `PATH`, `SHELL`, `USER`, `HOME`, `TERM`, `LANG`, `LC_*`, `NODE_ENV`, `PYTHON_VERSION`, `GH_REPO`, `DODAMI_DEBUG`, `DODAMI_DRY_RUN`, `DODAMI_ENV`, and `DODAMI_*_(FLAG|FLAGS|FEATURE|FEATURES|TOGGLE|ENABLED|DISABLED|MODE)`.
  - `PATH` is allowed only as a source for `command -v` tool path hints; never print the raw full `$PATH` value. In the env block, render it as `PATH=<omitted; tool paths captured above>`.
  - Banlist is case-insensitive and wins over the allowlist: never capture any env variable whose name matches `KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH`.
  - Omit the entire section if synthesis fails or yields no `pwd`, tool, or safe env hints.

  Inline capture pattern:

  ```bash
  ENV_ALLOW_RE='^(PATH|SHELL|USER|HOME|TERM|LANG|LC_[A-Z0-9_]*|NODE_ENV|PYTHON_VERSION|GH_REPO|DODAMI_(DEBUG|DRY_RUN|ENV)|DODAMI_[A-Z0-9_]+_(FLAG|FLAGS|FEATURE|FEATURES|TOGGLE|ENABLED|DISABLED|MODE))='
  ENV_BAN_RE='^[^=]*(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL|AUTH)[^=]*='

  SAFE_ENV_LINES=$(
    env \
      | LC_ALL=C grep -E "$ENV_ALLOW_RE" \
      | LC_ALL=C grep -Eiv "$ENV_BAN_RE" \
      | while IFS= read -r line; do
          case "$line" in
            PATH=*) printf '%s\n' 'PATH=<omitted; tool paths captured above>' ;;
            *) printf '%s\n' "$line" ;;
          esac
        done
  )

  project_uses_tool() {
    tool="$1"

    # Codex review P2 fold: require tool-SPECIFIC evidence, not just
    # "package.json exists". A repo using npm shouldn't surface pnpm/yarn
    # versions just because `package.json` is present.
    case "$tool" in
      node|npm|npx)
        [ -f "$REPO_ROOT/package.json" ] && return 0
        ;;
      pnpm)
        [ -f "$REPO_ROOT/pnpm-lock.yaml" ] && return 0
        ;;
      yarn)
        [ -f "$REPO_ROOT/yarn.lock" ] && return 0
        ;;
      tsx|tsc|vitest)
        # Require explicit reference in package.json (script or dependency)
        [ -f "$REPO_ROOT/package.json" ] && LC_ALL=C grep -q "\"$tool\"" "$REPO_ROOT/package.json" 2>/dev/null && return 0
        ;;
      python|python3|pip|pip3)
        [ -f "$REPO_ROOT/pyproject.toml" ] || [ -f "$REPO_ROOT/requirements.txt" ] || find "$REPO_ROOT" -maxdepth 3 -name '*.py' -print -quit 2>/dev/null | grep -q . && return 0
        ;;
      pytest)
        # Require explicit pytest config or fixture rather than any .py file
        { [ -f "$REPO_ROOT/pyproject.toml" ] && LC_ALL=C grep -q "pytest" "$REPO_ROOT/pyproject.toml" 2>/dev/null; } || [ -f "$REPO_ROOT/pytest.ini" ] || [ -f "$REPO_ROOT/conftest.py" ] && return 0
        ;;
      cargo|rustc)
        [ -f "$REPO_ROOT/Cargo.toml" ] && return 0
        ;;
    esac

    find "$REPO_ROOT/bin" "$REPO_ROOT/scripts" -maxdepth 2 -type f \( -name "$tool" -o -path "*/bin/$tool" \) -print -quit 2>/dev/null | grep -q . && return 0
    # Exclude the handoff skill's own prose (which lists every candidate
    # tool) from the fallback grep — otherwise `go`/`make`/etc would always
    # match.
    git -C "$REPO_ROOT" grep -I -q -E "(^|[^A-Za-z0-9_-])${tool}([^A-Za-z0-9_-]|$)" -- ':!node_modules' ':!.git' ':!.claude/skills/handoff/SKILL.md' 2>/dev/null && return 0
    git -C "$REPO_ROOT" log --all --format=%s --max-count=200 2>/dev/null | LC_ALL=C grep -Eiq "(^|[^A-Za-z0-9_-])${tool}([^A-Za-z0-9_-]|$)" && return 0
    return 1
  }

  capture_tool_version() {
    tool="$1"
    label="$2"

    project_uses_tool "$tool" || return 0
    command -v "$tool" >/dev/null 2>&1 || return 0
    tool_path=$(command -v "$tool" 2>/dev/null)
    version=$("$tool" --version 2>/dev/null | head -1)
    [ -n "$version" ] && printf -- '- %s: %s (%s)\n' "$label" "$version" "$tool_path"
  }

  TOOL_HINTS=$(
    capture_tool_version node Node
    capture_tool_version npm npm
    capture_tool_version pnpm pnpm
    capture_tool_version yarn yarn
    capture_tool_version python Python
    capture_tool_version python3 "Python 3"
    capture_tool_version pip pip
    capture_tool_version pip3 pip3
    capture_tool_version gh gh
    capture_tool_version codex codex
    capture_tool_version jq jq
    capture_tool_version docker docker
    capture_tool_version container container
    capture_tool_version sqlite3 sqlite3
    capture_tool_version tsx tsx
    capture_tool_version tsc tsc
    capture_tool_version vitest vitest
    capture_tool_version pytest pytest
    capture_tool_version cargo cargo
    capture_tool_version rustc rustc
    capture_tool_version go go
    capture_tool_version make make
  )
  ```
- `### Open Loops`:
  - **Next:** concrete next actions (1-3)
  - **Waiting:** depends-on-external (PR / deploy / codex consult / Will)
  - **Blocked:** blocker + what would unblock
  - **Drop / Did Not Do:** intentionally not migrating OR scope decisions, one-line `why` each
- `### Dirty Tree` (only if `DIRTY=true`): porcelain v2 output + diff stat + per-file intent line (`why dirty? commit? stash? leave?`)
- `### Worktree Map` (only if `WORKTREE_COUNT > 1`): abbreviated `git worktree list --porcelain` + identified collision risks
- `### Event Log`:
  - Always place this LAST in the body, after Dirty Tree and after Worktree Map. If Dirty Tree or Worktree Map is omitted, Event Log is still the final body section.
  - Event lines are markdown body content after the closing frontmatter `---`, never YAML.
  - Format every line as `<ISO-8601> <event-name> <terse-context>`, with context as parseable `key=value` tokens and no prose sentences. Examples:
    - `2026-05-18T01:00:00Z created session=red source=codex-claude`
    - `2026-05-18T01:30:00Z restored session=red staleness=FRESH last_verified_at=2026-05-18T01:30:00Z`
    - `2026-05-18T02:00:00Z superseded by=20260518-020000_main`
  - On SAVE, write the initial line as `<saved_at> created session=<SESSION_COLOR> source=<SOURCE_SESSION>`.
  - Canonical event names: `created`, `superseded`, `restored`, `last-verified-at-confirmed`, `marked-shipped`, `marked-abandoned`.
  - Append-only invariant: once an Event Log line is written, never edit, delete, sort, deduplicate, or rewrite it. Later flows append new lines at the bottom only. SHOW and LIST never write Event Log lines.

### Step 4: Compute supersession (frontmatter mutation + append-only Event Log write)

```bash
# Append a lifecycle event to a handoff body. This helper never edits or deletes
# existing body content. If an older handoff lacks the section, create the
# section at the bottom, then append the event line.
#
# IMPORTANT: do NOT use positional dollar-1/dollar-2 args. The Skill tool
# substitutes positional argument refs in the rendered SKILL.md BEFORE bash
# sees it (same bug class as the awk supersession parser at line ~155).
# Call with env-prefixed pseudo-args:
#   EVENT_FILE=<path> EVENT_LINE=<text> append_handoff_event
append_handoff_event() {
  if grep -q '^### Event Log$' "$EVENT_FILE"; then
    cat >> "$EVENT_FILE" <<EOF
$EVENT_LINE
EOF
  else
    cat >> "$EVENT_FILE" <<EOF

### Event Log

$EVENT_LINE
EOF
  fi
}

# Find prior in-progress handoffs on the same repo_root + branch.
#
# IMPORTANT: parse frontmatter with `sed -n 's/^  KEY: //p' | head -1`, NOT awk.
# The Skill tool substitutes positional argument refs (dollar-1 through dollar-9)
# in the rendered SKILL.md BEFORE bash sees it, so an awk field reference like
# (dollar-2) gets replaced by the user's second argument word (garbage).
# Using sed avoids positional-argument literals entirely.
# (Bug verified during 2026-05-17 dogfood — see SYNC.md follow-up note.)
PRIOR=$(find ~/.claude/projects/-Users-will-nanoclaw/memory -maxdepth 1 -name "handoff_*.md" -type f 2>/dev/null)
SUPERSEDES=()
SUPERSEDE_FILES=()
for f in $PRIOR; do
  P_REPO=$(sed -n 's/^  repo_root: //p' "$f" | head -1)
  P_BRANCH=$(sed -n 's/^  branch: //p' "$f" | head -1)
  P_STATUS=$(sed -n 's/^  status: //p' "$f" | head -1)
  P_ID=$(sed -n 's/^  handoff_id: //p' "$f" | head -1)
  if [ "$P_REPO" = "$REPO_ROOT" ] && [ "$P_BRANCH" = "$BRANCH" ] && [ "$P_STATUS" = "in-progress" ]; then
    SUPERSEDES+=("$P_ID")
    SUPERSEDE_FILES+=("$f")
  fi
done

# Codex review P1 fold: compute HANDOFF_ID here so the supersession event log
# line can reference it. The same SLUG + timestamp are reused by Step 5 when
# writing the new handoff file path — Step 5 must NOT recompute these.
ISO_NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
HANDOFF_TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
SLUG=$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | tr -s ' \t' '-' | tr -cd 'a-z0-9.-' | cut -c1-40)
[ -z "$SLUG" ] && SLUG=unknown
HANDOFF_ID="${HANDOFF_TIMESTAMP}_${SLUG}"

for i in "${!SUPERSEDES[@]}"; do
  prior_id="${SUPERSEDES[$i]}"
  prior_file="${SUPERSEDE_FILES[$i]}"

  # Frontmatter-only status mutation on the prior handoff.
  sed -i.bak '2,/^---$/s/^  status: in-progress$/  status: superseded/' "$prior_file"
  rm -f "$prior_file.bak"

  # Body mutation is limited to an append-only Event Log line.
  EVENT_FILE="$prior_file" EVENT_LINE="$ISO_NOW superseded by=$HANDOFF_ID" append_handoff_event
done
```

For each prior handoff in `SUPERSEDES`: edit its frontmatter `status:` field to `superseded`, append one `superseded` Event Log line to the bottom of that prior handoff, and prepend `[SUPERSEDED]` to its MEMORY.md entry. Existing body lines are untouched; the only body write is the append-only Event Log line.

### Step 5: Write the handoff file

Path: `~/.claude/projects/-Users-will-nanoclaw/memory/handoff_<YYYYMMDD-HHMMSS>_<branch-slug>.md`

**Timestamp comes BEFORE branch slug.** This ensures plain filename sort = chronological order across all branches/repos, which is the canonical order for `list --all`. Sorting by branch slug first (the v0 design) breaks `--all` ordering across branches.

Branch slug sanitize (allowlist + collision-safe; `/` must become `-` so `feat/foo` doesn't collide with `featfoo`). **Note:** `SLUG`, `HANDOFF_TIMESTAMP`, and `HANDOFF_ID` are already computed at the top of Step 4 so the supersession event log line can reference them. Step 5 reuses the same values — do NOT recompute (it would drift the timestamp).

```bash
# SLUG / HANDOFF_TIMESTAMP / HANDOFF_ID already set in Step 4. Shown here for
# reference only; do not recompute:
# SLUG=$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | tr -s ' \t' '-' | tr -cd 'a-z0-9.-' | cut -c1-40)
# [ -z "$SLUG" ] && SLUG=unknown
# HANDOFF_TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
# HANDOFF_ID="${HANDOFF_TIMESTAMP}_${SLUG}"
HANDOFF_FILE=~/.claude/projects/-Users-will-nanoclaw/memory/handoff_${HANDOFF_ID}.md
```

If the resulting file path already exists (same-second double save), append a 4-char random suffix before `.md`. Same-second duplicate stash messages are acceptable since restore uses git's message-search syntax.

Optional named stash creation runs after dirty-tree capture (Step 1) and before writing the frontmatter below. It is opt-in via `STASH_REQUESTED=true` (from `--stash` or save-time stash keyword) and fail-open:

```bash
if [ "$STASH_REQUESTED" = true ] && [ "$DIRTY" = true ]; then
  STASH_MESSAGE="handoff_${HANDOFF_ID}"
  STASH_EXIT=0
  # Use -u because DIRTY_FILES includes porcelain v2 `?` lines; untracked dirty
  # work must travel with the named stash when stash capture is explicitly requested.
  STASH_OUT=$(git stash push -u -m "$STASH_MESSAGE" 2>&1) || STASH_EXIT=$?

  if [ "$STASH_EXIT" -eq 0 ]; then
    STASH_REF="stash^{/${STASH_MESSAGE}}"
    STASH_NOTE="stash created: ${STASH_REF}"
  else
    STASH_ERR=$(printf '%s\n' "$STASH_OUT" | head -1 | cut -c1-160)
    [ -z "$STASH_ERR" ] && STASH_ERR="git stash push failed with exit ${STASH_EXIT}"
    STASH_REF="ERROR: ${STASH_ERR}"
    STASH_NOTE="stash failed — save continued: ${STASH_ERR}"
  fi
elif [ "$STASH_REQUESTED" = true ]; then
  STASH_REF=null
  STASH_NOTE="stash skipped — clean tree"
fi
```

A stash failure must not abort the save. Capture stderr via `2>&1`, record the error string in `stash_ref`, keep writing the handoff, and surface the failure in confirmation.

Frontmatter schema:

**IMPORTANT — YAML safety.** The user's auto-memory post-processor rewrites memory files with strict YAML semantics. Two consequences for `/handoff` frontmatter:

1. **Always double-quote `description` and any free-text field that can contain `#`, `:`, `"`, `'`, `[`, `]`, `{`, `}`, `&`, `*`, `!`, `|`, `>`, `%`, `@`, `` ` `` or leading whitespace.** Unquoted `description: PR #18 shipped` → post-processor reads `#18 shipped` as a YAML comment → description silently truncates to `PR`. (Verified 2026-05-17 dogfood — see SYNC.md.)
2. **`null`-valued fields are stripped** by the post-processor. Don't rely on `parent_handoff: null` to survive — omit the field instead, or quote `"null"` as a string if the literal value matters.

Treat the schema below as the SOURCE-OF-TRUTH SHAPE; the on-disk file may have `type` moved inside `metadata:`, `node_type: memory` injected, and `originSessionId` appended — that's the post-processor and is harmless. Read frontmatter with `sed -n 's/^  KEY: //p'` which is post-processor-tolerant.

```yaml
---
name: handoff_<timestamp>_<branch-slug>
description: "<one-line for MEMORY.md index — ALWAYS DOUBLE-QUOTED>"
type: handoff
metadata:
  handoff_id: <timestamp>_<branch-slug>
  parent_handoff: <parent-handoff-id>  # delta saves: required and used to resolve pointer lines; full saves: optional lineage only; omit if no parent (do NOT write `null`)
  supersedes: [<id>, ...]
  status: in-progress           # one of: in-progress | shipped | abandoned | superseded
  saved_at: <ISO-8601>
  last_verified_at: "<ISO-8601>"  # written only by restore after receipt render; omit on save/new files
  session_color: <color-or-null>
  source_session: claude         # or: codex-claude
  repo_root: <absolute path>
  branch: <name>
  head: <short SHA>
  upstream: <origin/branch-or-null>
  base_commit: <short SHA>
  is_worktree: true | false        # true if current checkout is a git worktree (not main repo)
  dirty: true | false
  dirty_files: [<path>, ...]
  stash_ref: "stash^{/handoff_<handoff_id>}"  # optional; success ref, or "ERROR: ..." if requested stash failed; omit when no stash was requested or clean-tree skip
  active_step: "<one-line — DOUBLE-QUOTED in case it contains : / # $ etc.>"
  first_action: "<one-line — DOUBLE-QUOTED — printed by restore, NEVER auto-executed>"
  next_owner: self | codex | will | external-wait
  blocked_until: "<one-line condition>"  # omit field if no blocker (do NOT write `null`)
  do_not_do:
    - "<item 1 — DOUBLE-QUOTED if it contains : # $ etc.>"
    - "<item 2>"
  resume_mode: read-only | dry-run | execute
  open_prs:
    - "#<N>|<url>"  # PR numbers contain `#` — REQUIRES quoting
  open_prs_probe_note: "<null-string-or-failure-message>"  # always quoted; use the literal string "null" if no note
  related_handoffs: [<id>, ...]
  files_modified: [<path>, ...]   # from dirty_files
  files_planned: [<path>, ...]    # synthesized from conversation
---
```

### Step 6: Update MEMORY.md index (unconditional)

Prepend one-line entry at the top of the appropriate section in `~/.claude/projects/-Users-will-nanoclaw/memory/MEMORY.md`:

```
- [<title>](handoff_<timestamp>_<slug>.md) — 🔄 IN PROGRESS — <repo>:<branch> — <one-line desc>
```

For each id in `SUPERSEDES`: find its MEMORY.md line and prepend `[SUPERSEDED]` tag.

### Step 7: Update SYNC.md if coordination-relevant

**Coordination-relevant predicate** (must be defined explicitly to prevent the "vague-criteria skip" failure):

```
COORDINATION_RELEVANT = (active_step is non-empty AND non-trivial)
                    OR (files_planned is non-empty)
                    OR (dirty == true)
                    OR (open_prs is non-empty)
                    OR (next_owner != "self" AND next_owner != null)
```

If true: write a `🔄 IN PROGRESS` SYNC.md entry per project CLAUDE.md HARD RULE. Anchor on a unique recent line; insert above the most recent existing IN PROGRESS entry. Re-read SYNC.md fresh this turn before editing (per § Cross-session collision avoidance).

If false: emit a one-line note in the save confirmation: `SYNC.md skip: <reason>` (e.g., `SYNC.md skip: clean tree, no planned files, no PR, self-owned`). Auditability over silent skip.

### Step 8: Generate copy-paste resume prompt (≤300 words)

```
I'm resuming work from a previous session. Run /handoff restore <handoff_id> to load context.

Quick summary: <task line>
Branch: <branch>
First action: <first_action> (printed as paste-ready; DO NOT auto-execute)
Blockers: <if any, else "none">

Read /handoff restore output for full state before any edit.
```

### Step 9: Confirm to user

Print:
- File path
- handoff_id
- The paste-prompt block (fenced for easy copy)
- SYNC.md status: written or `SYNC.md skip: <reason>`
- MEMORY.md: updated
- Stash status, only if requested: `stash created: stash^{/handoff_<handoff_id>}`, `stash skipped — clean tree`, or `stash failed — save continued: <error>`
- Superseded count (if any)
- "Next session: run `/handoff restore` to resume."

---

## RESTORE flow (read-only receipt + metadata-only verification write — HARD GATE)

### Step 1: Find target

```bash
HANDOFF_DIR=~/.claude/projects/-Users-will-nanoclaw/memory
CURRENT_REPO=$(git rev-parse --show-toplevel 2>/dev/null)
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
```

- `/handoff restore` (no arg) → newest `handoff_*.md` whose `repo_root` matches `CURRENT_REPO` AND `branch` matches `CURRENT_BRANCH`.
- `/handoff restore <id>` → exact handoff_id match.
- `/handoff restore <n>` → nth most recent matching default filter.
- `/handoff restore <fragment>` → title-fragment match across ALL handoffs (explicit lookup is broad; default is narrow).

If no match in current `repo+branch` but matches exist elsewhere: print `No handoff for <repo>:<branch>. Run /handoff list --all to browse all handoffs.` and exit (no further action).

### Step 2: Staleness probe + restore-time verification write

Compute:
- **Branch check:** `saved.branch == CURRENT_BRANCH`?
- **Head reachability:** is `saved.head` an ancestor of current HEAD? `git merge-base --is-ancestor <saved.head> HEAD 2>/dev/null`
- **Dirty drift:** if `saved.dirty == true`, compare `saved.dirty_files` set to current `git status --porcelain` dirty file set + diff stat. If saved `stash_ref` exists and does not start with `ERROR:`, do not flag solely because the current working tree is clean; the dirty capsule may have been moved into the named stash. Do not verify the stash exists at restore time.
- **PR check:** if `saved.open_prs` non-empty and `gh` available, query `gh pr view <n> --json state`; flag any MERGED or CLOSED.
- **Age basis:** read `saved.last_verified_at` first; if missing (v2.0 handoff), fall back to `saved.saved_at`.
- **Age:** `now - age_basis`.

Read the age basis before the restore-time write so old handoffs without `last_verified_at` degrade gracefully to the v2.0 `saved_at` behavior:

```bash
SAVED_AT=$(sed -n 's/^  saved_at: //p' "$HANDOFF_FILE" | head -1 | sed 's/^"//; s/"$//')
LAST_VERIFIED_AT=$(sed -n 's/^  last_verified_at: //p' "$HANDOFF_FILE" | head -1 | sed 's/^"//; s/"$//')
AGE_BASIS_AT=${LAST_VERIFIED_AT:-$SAVED_AT}
```

Verdict (compute, do NOT block on any verdict):
- **FRESH** = age < 1 day using `last_verified_at` when present, otherwise `saved_at`, AND branch matches AND head reachable AND (dirty file set matches if saved was dirty) AND all PRs open
- **STALE** = age > 7 days OR head not reachable OR branch deleted
- **WARN** = anything else

After computing the verdict, compute `last_verified_at = now()` and write it back to the selected handoff frontmatter. Then append one `restored` Event Log line to the selected handoff body. Do this only in RESTORE, immediately before printing the Step 3 receipt header. Do NOT run either write in SHOW.

```bash
append_handoff_event() {
  handoff_file="$1"
  event_line="$2"

  if grep -q '^### Event Log$' "$handoff_file"; then
    cat >> "$handoff_file" <<EOF
$event_line
EOF
  else
    cat >> "$handoff_file" <<EOF

### Event Log

$event_line
EOF
  fi
}

ISO_NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
if sed -n '2,/^---$/p' "$HANDOFF_FILE" | grep -q '^  last_verified_at:'; then
  sed -i.bak '2,/^---$/s/^  last_verified_at:.*$/  last_verified_at: "'"$ISO_NOW"'"/' "$HANDOFF_FILE"
else
  sed -i.bak '2,/^---$/s/^  saved_at:.*$/&\
  last_verified_at: "'"$ISO_NOW"'"/' "$HANDOFF_FILE"
fi
rm -f "$HANDOFF_FILE.bak"
last_verified_at="$ISO_NOW"

# VERDICT is the computed FRESH|WARN|STALE value from the staleness probe.
# Codex review P2 fold: compute CURRENT_SESSION_COLOR here using the same
# Claude/Codex-disambiguation logic as SAVE Step 1, so restore events
# don't fall back to session=unknown.
if [ -n "$CLAUDE_CODE_SESSION_ID" ] || [ -n "$CLAUDECODE" ]; then
  CURRENT_SESSION_COLOR=$(cat "$CURRENT_REPO/.claude/session-color" 2>/dev/null || echo null)
else
  CURRENT_SESSION_COLOR=$(/Users/will/.local/bin/codex-claude-session --root "$CURRENT_REPO" 2>/dev/null | sed -n 's/^Color: //p')
fi
[ -z "$CURRENT_SESSION_COLOR" ] && CURRENT_SESSION_COLOR=unknown
RESTORE_SESSION_COLOR="$CURRENT_SESSION_COLOR"
EVENT_FILE="$HANDOFF_FILE" EVENT_LINE="$ISO_NOW restored session=$RESTORE_SESSION_COLOR staleness=$VERDICT last_verified_at=$ISO_NOW" append_handoff_event
```

The sed range starts at line 2 so the opening `---` cannot close the range; it stops at the closing `---`. This mutates only frontmatter. The body write is limited to the append-only Event Log line at the bottom of the file; it never uses `sed -i` or range replacement against body content.

Post-processor tolerance: `last_verified_at` is a double-quoted ISO-8601 string, never `null`. To verify, write `last_verified_at: "2026-05-18T01:00:00Z"` with the same sed pattern, allow/simulate the auto-memory post-processor rewrite, then confirm `sed -n 's/^  last_verified_at: //p' "$HANDOFF_FILE" | head -1` still returns the field. Frontmatter reordering or injected metadata is acceptable as long as the field survives and `sed -n 's/^  KEY: //p'` continues to read it.

Concurrent restore note: do not add locking. Two parallel restores may race the frontmatter write and append two restore Event Log lines. This is accepted because both timestamps are real verification events seconds apart, frontmatter remains last-write-wins, and Event Log is append-only.

### Step 3: Read-only restore receipt

Before rendering the receipt, resolve delta pointer lines for RESTORE only. A section is delta-omitted when its first content line is exactly:

`<see parent_handoff: <parent-id> for unchanged <section-name>>`

For those sections, locate the parent by scanning handoff frontmatter for `handoff_id == <parent-id>` (do not assume filename equals id), read the same section from that parent, and substitute the parent's section content into the restore receipt. If the parent section is itself a pointer, follow the chain one parent at a time. Bound recursion at `MAX_DELTA_HOPS=5`; if the limit is reached, leave the pointer line in place and print `(parent unreachable: recursion limit reached while resolving <section-name>)` under that section. If `parent_handoff` is missing, the parent id cannot be found, or the parent file is unreadable, leave the pointer line in place and print `(parent unreachable: <parent-id>; showing delta pointer)` under that section. SHOW does not run this inflation step.

Print in this exact shape (the line `Reminder: write SYNC.md ... NOW` is the project CLAUDE.md HARD RULE nudge). If the resolved body contains `### Resume Commands` OR frontmatter has a successful `stash_ref` (present and not starting with `ERROR:`), print the Resume Commands section after Working set and before Environment Hints/Open loops as a separate fenced `bash` block. Print resolved saved resume commands verbatim first, then append `git stash pop "$(git stash list | grep 'handoff_<handoff_id>' | head -1 | cut -d: -f1)"` when `stash_ref` is successful. If `stash_ref` starts with `ERROR:`, print one non-code line `Stash: creation failed during save — <stash_ref>` and do not print a pop command. If there are no saved resume commands and no successful stash_ref, omit the `Resume Commands` label and code block entirely. If the resolved body contains `### Environment Hints`, print that section after Resume Commands and before Open loops. If the section is absent, omit the `Environment Hints` label and block entirely. If the saved body contains `### Event Log`, print that section after Open loops and before First action; because RESTORE appends the `restored` line before receipt rendering, the receipt includes the current restore event. Event Log is always written full and is never resolved through delta pointers. If the section is absent on an older handoff and append failed, omit the `Event Log` label rather than synthesizing lines.

````
RESUMING HANDOFF <handoff_id>
════════════════════════════════════════
Task:         <title>
Repo+branch:  <saved.repo_root>:<saved.branch>  (you are on: <current_repo>:<current_branch>)
Saved:        <relative time, e.g. "23 minutes ago" or "3 days ago">
Verified:     <last_verified_at>
Staleness:    FRESH | WARN | STALE — <one-line reason>
Session:      <saved.session_color> → now: <current_session_color>
════════════════════════════════════════

Active step:   <active_step>
Blocked until: <blocked_until or "no blockers">
Do NOT do:     <do_not_do list>
Resume mode:   <resume_mode>

Working set (read first):
  1. <file:line> — <why>
  2. <file:line> — <why>
  ...

Resume Commands (paste to wake this work up):
```bash
<resume_commands verbatim, if any>
git stash pop "$(git stash list | grep 'handoff_<handoff_id>' | head -1 | cut -d: -f1)"
```

Stash: creation failed during save — <stash_ref>

Environment Hints:
  Pwd:                 <saved pwd>
  Tools:
    - <tool>: <version> (<path from command -v>)
  Env (allowlist):
    - <NAME>=<value or PATH omitted marker>

Open loops:
  Next:                <items>
  Waiting:             <items>
  Drop / Did Not Do:   <items>

Event Log:
<event_log_lines verbatim, oldest first, including current restored event>

First action (paste-ready prompt for your NEXT turn — restore does NOT execute):
┌─────────────────────────────────────────────
│ <first_action verbatim>
└─────────────────────────────────────────────

--- Receipt confirmed. ---
Reminder: write a SYNC.md 🔄 IN PROGRESS entry NOW before edits (project CLAUDE.md HARD RULE).
````

### Step 4: Single AskUserQuestion — strict read-only options

```
Q: How do you want to proceed?
  A) Print first-action as a paste-ready prompt for your NEXT turn (Recommended)
     — restore does NOT execute. You trigger execution by pasting / proceeding.
  B) Show full body (decisions, dirty tree, worktree map, full open loops with reasons)
  C) Just needed the context, thanks
```

**HARD GATE enforcement:** None of A/B/C cause file edits, shell mutations, or external API calls inside this skill invocation. Option A prints; option B reads + prints; option C exits.

If A: print the first_action prominently again with the cue "Paste this or proceed in your next message to trigger." End.
If B: read the rest of the handoff body and print it. End.
If C: just exit.

---

## SHOW flow (strict read-only — HARD GATE, no AskUserQuestion)

Purpose: zero-friction restore option B. It prints the restore receipt header plus the full saved handoff body in one shot.

### Step 1: Find target (reuse RESTORE Step 1)

Use RESTORE Step 1 exactly for target resolution, treating `/handoff show [<id|n|fragment>]` as `/handoff restore [<id|n|fragment>]` for lookup only:

- `/handoff show` (no arg) → same default as restore: newest handoff for current `repo_root + branch`.
- `/handoff show <id>` → same exact `handoff_id` lookup as restore.
- `/handoff show <n>` → same nth-most-recent lookup as restore.
- `/handoff show <fragment>` → same broad title-fragment lookup as restore.

Do NOT maintain a second copy of the target-resolution logic. If RESTORE Step 1 changes, SHOW inherits that behavior by reference.

For explicit `<id|n|fragment>`, sanitize before lookup: reject selectors containing `/`, `\`, NUL, or `..`; then compare using an allowlisted selector (`A-Za-z0-9._ -`, max 120 chars). Treat the selector as data only. Never concatenate raw user input into a path.

### Step 2: Build the read-only receipt header

Run RESTORE Step 2's staleness probe and print RESTORE Step 3's receipt header. This may use read-only git commands and optional read-only `gh pr view` for PR state only.

Compute `last_verified_at` for display only. Do NOT write `last_verified_at` or any other frontmatter field back to the handoff file.

### Step 3: Print the full body and exit

After the receipt header, print:

```text
--- Full handoff body ---
<all non-frontmatter body text from the selected handoff>
--- End handoff ---
```

Read the selected handoff file and print the body exactly as saved, including any delta pointer lines like `<see parent_handoff: <id> for unchanged <section-name>>`. Delta resolution is RESTORE's job; SHOW is a raw inspection flow. Do not ask A/B/C. Do not call Edit/Write. Do not perform shell mutations (`sed -i`, redirects to files, temp-file writes, status updates) and do not make external API calls beyond optional read-only `gh pr view` from the staleness probe.

---

## LIST flow

### Step 1: Collect candidates

```bash
find ~/.claude/projects/-Users-will-nanoclaw/memory -maxdepth 1 -name "handoff_*.md" -type f | sort -r
```

(Filename `handoff_<YYYYMMDD-HHMMSS>_<slug>.md` puts timestamp BEFORE slug so `sort -r` gives true chronological order across all branches/repos. Filename sort is robust across rsync/copy unlike mtime.)

### Step 2: Filter

```bash
CURRENT_REPO=$(git rev-parse --show-toplevel 2>/dev/null)
CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
```

- Default: include only handoffs whose frontmatter `repo_root == CURRENT_REPO AND branch == CURRENT_BRANCH`.
- `--all`: include everything.

Parse frontmatter inline with `sed`. Avoid awk patterns that reference positional fields (`dollar-1`, `dollar-2`, ...) because the Skill tool substitutes those at SKILL.md render time before bash sees them, clobbering awk's field references (verified 2026-05-17 dogfood). `yq` works too if available, but the sed form has no dependency:

```bash
# For each handoff file $f, extract one field with:
#   sed -n 's/^  KEY: //p' "$f" | head -1
# Example uses below in the per-row loop:
for f in $CANDIDATES; do
  F_REPO=$(sed -n 's/^  repo_root: //p' "$f" | head -1)
  F_BRANCH=$(sed -n 's/^  branch: //p' "$f" | head -1)
  F_STATUS=$(sed -n 's/^  status: //p' "$f" | head -1)
  F_DIRTY=$(sed -n 's/^  dirty: //p' "$f" | head -1)
  F_NEXT=$(sed -n 's/^  next_owner: //p' "$f" | head -1)
  F_SAVED=$(sed -n 's/^  saved_at: //p' "$f" | head -1)
  F_DESC=$(sed -n 's/^description: //p' "$f" | head -1)
  # Apply repo+branch filter unless --all
  ...
done
```

### Step 3: Render table

Default (current repo+branch):
```
HANDOFFS (<repo-basename>:<branch>)
════════════════════════════════════════════════════
#   Age    Title                          Status         Dirty   Next owner
─   ─────  ─────────────────────────────  ─────────────  ──────  ──────────
1   23m    /handoff v2 plan locked        🔄 in-progress  no      self
2   3d     S-F05 R6 follow-up             ✅ shipped     -       —
3   6d     [SUPERSEDED] earlier draft     ⊘ superseded   -       —
════════════════════════════════════════════════════
```

With `--all`, add Repo + Branch columns; drop the title-bar repo+branch annotation.

### Step 4: Empty result

If no matches under default filter: `No handoffs for <repo>:<branch>. Run /handoff list --all to see all handoffs.`
If no matches under `--all`: `No handoffs yet. Run /handoff to save your current state.`

---

## Hook integration

Tracked clones install `.claude/hooks/precompact-handoff-reminder.sh` through `.claude/settings.json` as a `PreCompact` hook. It is print-only: before Claude Code compacts context, it reminds the user to run `/handoff save` if in-progress work should survive compaction. It must never auto-run save or block compaction.

---

## Cross-feature notes

- **Save** updates MEMORY.md unconditionally; updates SYNC.md iff coordination-relevant predicate is true; writes the new handoff body with an initial `created` Event Log line; marks prior same-(repo+branch) in-progress handoffs as `superseded` (frontmatter `status:` mutation) and appends one `superseded` Event Log line to each prior handoff. Save is the only flow that authors a new handoff body: initial body authoring is allowed by the HARD GATE's new-handoff-file write allowance. In delta mode, Save still writes a complete new handoff file, but eligible unchanged sections may contain only the parseable pointer line `<see parent_handoff: <id> for unchanged <section-name>>`; `parent_handoff` carries the chain for restore-time inflation. Later body writes are limited to append-only Event Log lines. If and only if `STASH_REQUESTED=true`, Save may additionally run the opt-in git mutation `git stash push -u -m "handoff_<handoff_id>"` after dirty capture; this is explicitly carved into the HARD GATE because it mutates git stash state and cleans the working tree.
- **Restore** writes `last_verified_at:` to the selected handoff frontmatter after the staleness probe and appends one `restored` Event Log line to the selected handoff body. It never writes to SYNC.md or MEMORY.md, never edits or deletes existing body lines, and never executes `first_action`, Resume Commands, Environment Hints, or stash pop. Before printing the receipt, Restore inflates delta pointer sections through `parent_handoff` recursively up to 5 hops; if a parent is unreachable, it warns and prints the pointer line instead of failing. If present, Resume Commands, Environment Hints, and Event Log are printed from the resolved saved body only after the restore append completes. If successful `stash_ref` is present, restore prints `git stash pop "$(git stash list | grep 'handoff_<handoff_id>' | head -1 | cut -d: -f1)"` as a paste-ready cue in Resume Commands and does not verify or pop it.
- **Show** never writes to SYNC.md, MEMORY.md, the handoff file, the Event Log, or anywhere else. Print-only; it is restore option B exposed as a no-AUQ top-level flow. Because show prints the restore receipt plus the full saved body verbatim, optional Resume Commands, stash pop cue, Environment Hints, Event Log, and delta pointer lines surface naturally there too; Show does not resolve delta pointers.
- **List** never writes anywhere. Print-only.
- **Status marking** (`marked-shipped`, `marked-abandoned`) is an Event Log convention for explicit status-marking flows. Do not infer those events from MEMORY.md/SYNC.md prose; append them only when the handoff file's `status:` is explicitly changed to `shipped` or `abandoned`.

## Failure modes covered (from codex rigor review)

- **F1:** Restore's option A prints first_action, never executes it. Execution requires a separate user turn.
- **F2:** Default restore/show/list filter is `repo_root + branch`. Prevents NanoClaw/Dodami main-vs-main collision.
- **F3:** Staleness probe includes dirty-drift comparison (saved vs current dirty file set + diff stat).
- **F4:** `superseded` is in the status enum. Frontmatter mutations (`status:` supersession and restore-time `last_verified_at:` writes) are explicitly carved out from the no-arbitrary-file-mutation rule. Concurrent restores may race on `last_verified_at`; last-write-wins is accepted because competing values are verification timestamps seconds apart.
- **F5:** Coordination-relevant predicate defined explicitly with 5 conditions (active_step / files_planned / dirty / open_prs / next_owner≠self).
- **F6:** `gh pr list` is fail-open: missing/unauth gh → `open_prs: []` + `open_prs_probe_note`, save never aborts.
- **F7:** Event Log is append-only body content. SAVE, RESTORE, supersession, and explicit status-marking flows may append lines; they must never edit, delete, sort, deduplicate, truncate, or rewrite existing Event Log lines. If the section is missing, create `### Event Log` at the bottom with `cat >> "$HANDOFF_FILE" <<EOF`; if it exists, append the new line at the bottom. SHOW and LIST must never write Event Log lines.
- **F8:** Delta parent unreachable fallback is fail-open at restore time. If a section pointer references a missing/unreadable parent, missing section, missing `parent_handoff`, or a chain deeper than 5 hops, RESTORE prints a warning and shows the delta pointer line instead of blocking or inventing content. SHOW always prints pointer lines verbatim.
- **F9:** Named stash creation is opt-in and fail-open. `/handoff save --stash` or explicit save-time stash keywords run `git stash push -u -m "handoff_<handoff_id>"` only when `DIRTY=true`; clean trees print `stash skipped — clean tree`. If git stash fails, capture stderr, write `stash_ref: "ERROR: <message>"` for audit, print `stash failed — save continued`, and continue writing the handoff/MEMORY/SYNC entries.

## Cuts applied (from codex simplicity review)

- **C1:** v2.0 cut `/handoff show` because restore option B existed; v2.1 reverses this as a read-only, no-AUQ top-level flow for zero-friction body reads.
- **C2:** Environment Hints is now adopted as an optional save-time body section. Restore/show print saved hints only; they never recompute or restore environment.
- **C4:** Event Log is now adopted as an append-only body audit trail. SAVE writes `created`; supersession appends `superseded` to prior handoffs; RESTORE appends `restored`; SHOW/LIST remain read-only.
- **C3:** Resume Commands is now adopted as an optional save-time body section. Restore/show print those commands only; they never execute them.
- **C5:** Symbol Map is nested under Working Set (not a separate adopted feature).
- **C6:** "Did NOT Do" merged into Open Loops `Drop / Did Not Do`.
- **C7:** v2.0 computed `last_verified_at` at restore time without storing it. v2.1 reverses this only for restore: `/handoff restore` writes `last_verified_at` back to frontmatter as a metadata-only mutation; `/handoff save` still never writes it, and `/handoff show` remains read-only/display-only.
