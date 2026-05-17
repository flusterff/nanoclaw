---
name: handoff
description: |
  Save / restore / list cross-session handoffs. Captures git state, decisions, working
  set, open loops + generates a copy-paste resume prompt. Symmetric restore: a fresh
  session runs /handoff restore to load context as a read-only receipt before any edit.
  Triggers on "handoff", "save and switch", "new session", "pick up later",
  "prepare handoff", "save progress for next session", "resume", "where was I",
  "restore context", "list handoffs", "what handoffs do I have".
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

Manage handoffs with three subcommands: `save`, `restore`, `list`.

**HARD GATE (applies to all subcommands):** This skill NEVER modifies code or arbitrary files. It writes ONLY: (1) new handoff files in the memory dir, (2) MEMORY.md index entries, (3) SYNC.md coordination entries when relevant, (4) `status:` field updates on superseded prior handoffs (metadata-only mutation, body untouched). Restore is strictly read-only; restoring a handoff with `first_action: edit X.py` prints that line as a paste-ready prompt for the user's NEXT turn — it does NOT execute it inside the skill invocation.

## Subcommand routing

Parse the user's input:

- `/handoff` → **save** (no title — infer from conversation context)
- `/handoff <title>` → **save** with the given title
- `/handoff save [<title>]` → **save** (explicit form)
- `/handoff restore [<id|n|fragment>]` → **restore** (default: latest matching current repo + branch; arg can be handoff id, numeric index, or title fragment)
- `/handoff list [--all]` → **list** (default filter: current repo_root + branch; `--all` lifts BOTH filters)

If the first arg is none of the above keywords and looks like a title, treat as `save <title>`.

---

## SAVE flow

### Step 1: Pre-flight probe (bash, all fail-open)

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "ERROR: not in a git repo"; exit 2; }
BRANCH=$(git branch --show-current 2>/dev/null || echo unknown)
HEAD_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
BASE_COMMIT=$(git rev-parse --short "$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo HEAD)" 2>/dev/null || echo unknown)
UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo null)
git status --porcelain=v2 --branch 2>/dev/null > /tmp/_handoff_status.tmp
DIRTY_FILES=$(awk '/^[12u?] /{print $NF}' /tmp/_handoff_status.tmp | head -50)
[ -n "$DIRTY_FILES" ] && DIRTY=true || DIRTY=false
DIFF_STAT=$(git diff --stat 2>/dev/null | tail -30)
DIFF_NAMES=$(git diff --name-status 2>/dev/null | head -50)
WORKTREES=$(git worktree list --porcelain 2>/dev/null)
WORKTREE_COUNT=$(echo "$WORKTREES" | awk '/^worktree /' | wc -l | tr -d ' ')
# Detect sibling-worktree mode (git-common-dir != .git means we're in a worktree, not main repo).
# IS_WORKTREE is what callers actually need; the actual checkout root is REPO_ROOT (above).
COMMON_DIR=$(git rev-parse --git-common-dir 2>/dev/null)
[ "$COMMON_DIR" = ".git" ] && IS_WORKTREE=false || IS_WORKTREE=true
SESSION_COLOR=$(cat .claude/session-color 2>/dev/null || echo null)
# Fail-open gh pr list. IMPORTANT: derive --repo from origin URL — default `gh pr list`
# queries upstream-tracked remote, which on a fork (e.g. flusterff/nanoclaw) misses PRs
# you actually care about (per project HARD RULE feedback_never_pr_to_upstream_nanoclaw).
GH_REPO=$(git config --get remote.origin.url 2>/dev/null | sed -E 's|.*[:/]([^/]+/[^/.]+)(\.git)?$|\1|')
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  OPEN_PRS=$(gh pr list --head "$BRANCH" --repo "$GH_REPO" --json number,url -q '.[] | "#\(.number)|\(.url)"' 2>/dev/null | head -10)
  PR_PROBE_NOTE=null
elif ! command -v gh >/dev/null 2>&1; then
  OPEN_PRS=""; PR_PROBE_NOTE="gh missing"
else
  OPEN_PRS=""; PR_PROBE_NOTE="gh unauthenticated"
fi
```

If `git rev-parse --show-toplevel` fails, abort with a clear error before writing anything.

### Step 2: One-question capture override (optional, single AUQ)

Skip this step entirely if:
- A title was provided in the user's invocation
- The user provided specific constraints in this turn
- Pre-flight detected rich body context (planned files, decisions in conversation)

Otherwise, ONE AskUserQuestion: "Anything the new session must preserve that I might miss?" with a free-text field plus a skip option. Cap friction at ~30s.

### Step 3: Synthesize body sections from conversation context

Sections to include (omit any that are empty — never write empty headers):

- `## Working on: <title>` + `### Summary` (1-3 sentences)
- `### Decisions Made` — bullets with "why" each
- `### Working Set`:
  - **Read-first:** ordered files+ranges (1-5 entries)
  - **Key symbols:** `file:line — function/class — why it matters` (max ~5)
  - **Do not touch:** files explicitly out of scope
- `### Open Loops`:
  - **Next:** concrete next actions (1-3)
  - **Waiting:** depends-on-external (PR / deploy / codex consult / Will)
  - **Blocked:** blocker + what would unblock
  - **Drop / Did Not Do:** intentionally not migrating OR scope decisions, one-line `why` each
- `### Dirty Tree` (only if `DIRTY=true`): porcelain v2 output + diff stat + per-file intent line (`why dirty? commit? stash? leave?`)
- `### Worktree Map` (only if `WORKTREE_COUNT > 1`): abbreviated `git worktree list --porcelain` + identified collision risks

### Step 4: Compute supersession (metadata-only mutation)

```bash
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
for f in $PRIOR; do
  P_REPO=$(sed -n 's/^  repo_root: //p' "$f" | head -1)
  P_BRANCH=$(sed -n 's/^  branch: //p' "$f" | head -1)
  P_STATUS=$(sed -n 's/^  status: //p' "$f" | head -1)
  P_ID=$(sed -n 's/^  handoff_id: //p' "$f" | head -1)
  if [ "$P_REPO" = "$REPO_ROOT" ] && [ "$P_BRANCH" = "$BRANCH" ] && [ "$P_STATUS" = "in-progress" ]; then
    SUPERSEDES+=("$P_ID")
    # Metadata-only update on the prior handoff: rewrite `  status: in-progress` →
    # `  status: superseded`. Body untouched. Use `sed -i.bak` for atomic in-place edit,
    # then rm the backup. Operates only on the frontmatter block.
  fi
done
```

For each prior handoff in `SUPERSEDES`: edit its frontmatter `status:` field to `superseded`. Body lines untouched. MEMORY.md entry for that handoff: prepend `[SUPERSEDED]` tag.

### Step 5: Write the handoff file

Path: `~/.claude/projects/-Users-will-nanoclaw/memory/handoff_<YYYYMMDD-HHMMSS>_<branch-slug>.md`

**Timestamp comes BEFORE branch slug.** This ensures plain filename sort = chronological order across all branches/repos, which is the canonical order for `list --all`. Sorting by branch slug first (the v0 design) breaks `--all` ordering across branches.

Branch slug sanitize (allowlist + collision-safe; `/` must become `-` so `feat/foo` doesn't collide with `featfoo`):

```bash
SLUG=$(echo "$BRANCH" | tr '/' '-' | tr '[:upper:]' '[:lower:]' | tr -s ' \t' '-' | tr -cd 'a-z0-9.-' | cut -c1-40)
[ -z "$SLUG" ] && SLUG=unknown
```

If the resulting file path already exists (same-second double save), append a 4-char random suffix before `.md`.

Frontmatter schema:

```yaml
---
name: handoff_<timestamp>_<branch-slug>
description: <one-line for MEMORY.md index>
type: handoff
metadata:
  handoff_id: <timestamp>_<branch-slug>
  parent_handoff: <previous-handoff-id-or-null>
  supersedes: [<id>, ...]
  status: in-progress           # one of: in-progress | shipped | abandoned | superseded
  saved_at: <ISO-8601>
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
  active_step: <one-line>
  first_action: <one-line — printed by restore, NEVER auto-executed>
  next_owner: self | codex | will | external-wait
  blocked_until: <one-line condition or null>
  do_not_do: [<list>]
  resume_mode: read-only | dry-run | execute
  open_prs: [<#N|url>, ...]
  open_prs_probe_note: <null | "gh missing" | "gh unauthenticated">
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
- Superseded count (if any)
- "Next session: run `/handoff restore` to resume."

---

## RESTORE flow (strict read-only — HARD GATE)

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

### Step 2: Staleness probe (read-only)

Compute:
- **Branch check:** `saved.branch == CURRENT_BRANCH`?
- **Head reachability:** is `saved.head` an ancestor of current HEAD? `git merge-base --is-ancestor <saved.head> HEAD 2>/dev/null`
- **Dirty drift:** if `saved.dirty == true`, compare `saved.dirty_files` set to current `git status --porcelain` dirty file set + diff stat. Flag if changed.
- **PR check:** if `saved.open_prs` non-empty and `gh` available, query `gh pr view <n> --json state`; flag any MERGED or CLOSED.
- **Age:** `now - saved.saved_at`.

Compute `last_verified_at = now()` (restore-time only; not written back to the saved file).

Verdict (compute, do NOT block on any verdict):
- **FRESH** = age < 1 day AND branch matches AND head reachable AND (dirty file set matches if saved was dirty) AND all PRs open
- **STALE** = age > 7 days OR head not reachable OR branch deleted
- **WARN** = anything else

### Step 3: Read-only restore receipt

Print in this exact shape (the line `Reminder: write SYNC.md ... NOW` is the project CLAUDE.md HARD RULE nudge):

```
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

Open loops:
  Next:                <items>
  Waiting:             <items>
  Drop / Did Not Do:   <items>

First action (paste-ready prompt for your NEXT turn — restore does NOT execute):
┌─────────────────────────────────────────────
│ <first_action verbatim>
└─────────────────────────────────────────────

--- Receipt confirmed. ---
Reminder: write a SYNC.md 🔄 IN PROGRESS entry NOW before edits (project CLAUDE.md HARD RULE).
```

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

## Cross-feature notes

- **Save** updates MEMORY.md unconditionally; updates SYNC.md iff coordination-relevant predicate is true; marks prior same-(repo+branch) in-progress handoffs as `superseded` (metadata-only mutation of `status:` field, body untouched).
- **Restore** never writes to SYNC.md, MEMORY.md, the handoff file, or anywhere else. Print-only.
- **List** never writes anywhere. Print-only.

## Failure modes covered (from codex rigor review)

- **F1:** Restore's option A prints first_action, never executes it. Execution requires a separate user turn.
- **F2:** Default restore/list filter is `repo_root + branch`. Prevents NanoClaw/Dodami main-vs-main collision.
- **F3:** Staleness probe includes dirty-drift comparison (saved vs current dirty file set + diff stat).
- **F4:** `superseded` is in the status enum. Metadata-only mutation explicitly carved out from append-only rule.
- **F5:** Coordination-relevant predicate defined explicitly with 5 conditions (active_step / files_planned / dirty / open_prs / next_owner≠self).
- **F6:** `gh pr list` is fail-open: missing/unauth gh → `open_prs: []` + `open_prs_probe_note`, save never aborts.

## Cuts applied (from codex simplicity review)

- **C1:** No `/handoff show` subcommand. Use restore's option B.
- **C2/C3/C4:** No Environment Hints / Resume Commands / Event Log body sections in v2.0. Deferred to v2.1 — each is cheaply addable as a single body section.
- **C5:** Symbol Map is nested under Working Set (not a separate adopted feature).
- **C6:** "Did NOT Do" merged into Open Loops `Drop / Did Not Do`.
- **C7:** `last_verified_at` is computed at restore time, not stored in save frontmatter.
