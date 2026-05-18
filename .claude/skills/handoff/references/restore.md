## RESTORE flow (read-only receipt + metadata-only verification write — HARD GATE)

### Step 1: Find target

```bash
HANDOFF_DIR=~/.claude/projects/-Users-will-nanoclaw/memory
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
CURRENT_REPO=""
for candidate in "$LAUNCH_CWD" "${PWD:-}" "$(pwd 2>/dev/null)"; do
  CURRENT_REPO=$(REPO_CANDIDATE="$candidate" normalize_repo_candidate) && [ -n "$CURRENT_REPO" ] && break
done
if [ -n "$CURRENT_REPO" ]; then
  CURRENT_BRANCH=$(git -C "$CURRENT_REPO" branch --show-current 2>/dev/null)
else
  CURRENT_BRANCH=""
fi
```

- `/handoff restore` (no arg) → newest `handoff_*.md` whose `repo_root` matches `CURRENT_REPO` AND `branch` matches `CURRENT_BRANCH`.
- `/handoff restore <id>` → exact handoff_id match.
- `/handoff restore <n>` → nth most recent matching default filter.
- `/handoff restore <fragment>` → title-fragment match across ALL handoffs (explicit lookup is broad; default is narrow).

If no match in current `repo+branch` but matches exist elsewhere: print `No handoff for <repo>:<branch>. Run /handoff list --all to browse all handoffs.` and exit (no further action).

### Step 2: Staleness probe + restore-time verification write

Compute:

- **Branch check:** `saved.branch == CURRENT_BRANCH`?
- **Head reachability:** is `saved.head` an ancestor of current HEAD? `git -C "$CURRENT_REPO" merge-base --is-ancestor <saved.head> HEAD 2>/dev/null`
- **Dirty drift:** if `saved.dirty == true`, compare `saved.dirty_files` set to current `git -C "$CURRENT_REPO" status --porcelain` dirty file set + `git -C "$CURRENT_REPO" diff HEAD --stat`. If saved `stash_ref` exists and does not start with `ERROR:`, do not flag solely because the current working tree is clean; the dirty capsule may have been moved into the named stash. Do not verify the stash exists at restore time.
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

Print in this exact shape (the line `Reminder: write SYNC.md ... NOW` is the project CLAUDE.md HARD RULE nudge). If the resolved body contains `### Resume Commands` OR frontmatter has a successful `stash_ref` (present and not starting with `ERROR:`), print the Resume Commands section after Working set and before Environment Hints/Open loops as a separate fenced `bash` block. Print resolved saved resume commands verbatim first, then append `git -C "<saved repo_root>" stash pop "$(git -C "<saved repo_root>" stash list | grep 'handoff_<handoff_id>' | head -1 | cut -d: -f1)"` when `stash_ref` is successful. If `stash_ref` starts with `ERROR:`, print one non-code line `Stash: creation failed during save — <stash_ref>` and do not print a pop command. If there are no saved resume commands and no successful stash_ref, omit the `Resume Commands` label and code block entirely. If the resolved body contains `### Environment Hints`, print that section after Resume Commands and before Open loops. If the section is absent, omit the `Environment Hints` label and block entirely. If the saved body contains `### Event Log`, print that section after Open loops and before First action; because RESTORE appends the `restored` line before receipt rendering, the receipt includes the current restore event. Event Log is always written full and is never resolved through delta pointers. If the section is absent on an older handoff and append failed, omit the `Event Log` label rather than synthesizing lines.

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
git -C "<saved repo_root>" stash pop "$(git -C "<saved repo_root>" stash list | grep 'handoff_<handoff_id>' | head -1 | cut -d: -f1)"
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
