## SAVE flow

### Step 1: Pre-flight probe (bash, all fail-open)

```bash
# STASH_REQUESTED is set by Subcommand routing for `/handoff save --stash`,
# `stash`, `with stash`, or `and stash`. Default is no stash.
: "${STASH_REQUESTED:=false}"
STASH_REF=null
STASH_NOTE=null

LAUNCH_CWD=""
if { [ -n "$CLAUDE_CODE_SESSION_ID" ] || [ -n "$CLAUDECODE" ]; } && [ -n "$CLAUDE_CODE_SESSION_ID" ]; then
  # Codex review P1 fold: line 2 isn't always cwd (NanoClaw JSONLs have
  # agent-color/last-prompt records early). Scan the first 20 records for
  # the first non-empty `cwd` field.
  LAUNCH_CWD=$(head -20 "$HOME/.claude/projects/-Users-will-nanoclaw/${CLAUDE_CODE_SESSION_ID}.jsonl" 2>/dev/null | python3 -c 'import json, sys
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        rec = json.loads(line)
    except Exception:
        continue
    cwd = rec.get("cwd") or ""
    if cwd:
        print(cwd)
        break' 2>/dev/null)
fi
normalize_repo_candidate() {
  [ -n "$REPO_CANDIDATE" ] || return 1
  git -C "$REPO_CANDIDATE" rev-parse --show-toplevel 2>/dev/null
}
REPO_ROOT=""
for candidate in "$LAUNCH_CWD" "${PWD:-}" "$(pwd 2>/dev/null)"; do
  REPO_ROOT=$(REPO_CANDIDATE="$candidate" normalize_repo_candidate) && [ -n "$REPO_ROOT" ] && break
done
[ -n "$REPO_ROOT" ] || { echo "ERROR: not in a git repo (checked Claude launch cwd, PWD, pwd)"; exit 2; }
BRANCH=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo unknown)
HEAD_SHA=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)
BASE_COMMIT=$(git -C "$REPO_ROOT" rev-parse --short "$(git -C "$REPO_ROOT" merge-base HEAD main 2>/dev/null || git -C "$REPO_ROOT" merge-base HEAD master 2>/dev/null || echo HEAD)" 2>/dev/null || echo unknown)
UPSTREAM=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo null)
# Keep porcelain output in a bash variable, not a temp file. Avoids /tmp clobber
# under concurrent /handoff save invocations and keeps the skill's writes scoped
# to memory dir + MEMORY.md + SYNC.md per the HARD GATE.
STATUS_OUT=$(git -C "$REPO_ROOT" status --porcelain=v2 --branch 2>/dev/null)
DIRTY_FILES=$(echo "$STATUS_OUT" | awk '/^[12u?] /{print $NF}' | head -50)
[ -n "$DIRTY_FILES" ] && DIRTY=true || DIRTY=false
# Use `git -C "$REPO_ROOT" diff HEAD` so the Dirty Tree section captures
# BOTH staged AND unstaged hunks. Bare `git diff` only shows unstaged — a fully
# staged dirty tree would render as empty diff in the saved handoff.
DIFF_STAT=$(git -C "$REPO_ROOT" diff HEAD --stat 2>/dev/null | tail -30)
DIFF_NAMES=$(git -C "$REPO_ROOT" diff HEAD --name-status 2>/dev/null | head -50)
WORKTREES=$(git -C "$REPO_ROOT" worktree list --porcelain 2>/dev/null)
WORKTREE_COUNT=$(echo "$WORKTREES" | awk '/^worktree /' | wc -l | tr -d ' ')
# Detect sibling-worktree mode (git-common-dir != .git means we're in a worktree, not main repo).
# IS_WORKTREE is what callers actually need; the actual checkout root is REPO_ROOT (above).
COMMON_DIR=$(git -C "$REPO_ROOT" rev-parse --git-common-dir 2>/dev/null)
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
GH_REPO=$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null | sed -E 's|.*[:/]([^/]+/[^/.]+)(\.git)?$|\1|')
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

Resolve `REPO_ROOT` by trying Claude Code's session-launch `cwd` from JSONL line 2 first when `CLAUDE_CODE_SESSION_ID` is available, then `$PWD`, then `pwd`; normalize each candidate with `git -C "$candidate" rev-parse --show-toplevel`. If all candidates fail, abort with a clear error before writing anything.

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

Eligible for delta omission: `### Decisions Made`, `### Deviations`, `### Working Set`, `### Resume Commands`, `### Environment Hints`, `### Dirty Tree`, `### Worktree Map`.

Always write full: `### Summary`, `### Open Loops`, `### Event Log`, and the `## Working on: <title>` line. If the parent section is missing or unreadable at save time, write the new section content in full.

- `## Working on: <title>` + `### Summary` (1-3 sentences)
- `### Decisions Made` — bullets with "why" each
- `### Deviations` — unspecified-spec decisions logged per user CLAUDE.md § Deviation log: one bullet per `DEVIATION:` line from this session (source: session scratchpad `deviations.md` or the task's SYNC entry), plus any proposed-but-not-yet-approved harness diffs. Omit only if no `DEVIATION:` lines were logged this session AND no proposed-but-unapproved harness diffs remain from the parent handoff; otherwise synthesize the section (delta comparison applies as usual).
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
    # Exclude the handoff skill's own prose (SKILL.md AND references/*.md
    # both list every candidate tool) from the fallback grep — otherwise
    # `go`/`make`/etc would always match against the skill's own
    # documentation.
    git -C "$REPO_ROOT" grep -I -q -E "(^|[^A-Za-z0-9_-])${tool}([^A-Za-z0-9_-]|$)" -- ':!node_modules' ':!.git' ':!.claude/skills/handoff' 2>/dev/null && return 0
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
  STASH_OUT=$(git -C "$REPO_ROOT" stash push -u -m "$STASH_MESSAGE" 2>&1) || STASH_EXIT=$?

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

<!-- prettier-ignore-start -->
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
<!-- prettier-ignore-end -->

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
