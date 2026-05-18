## LIST flow

### Step 1: Collect candidates

```bash
find ~/.claude/projects/-Users-will-nanoclaw/memory -maxdepth 1 -name "handoff_*.md" -type f | sort -r
```

(Filename `handoff_<YYYYMMDD-HHMMSS>_<slug>.md` puts timestamp BEFORE slug so `sort -r` gives true chronological order across all branches/repos. Filename sort is robust across rsync/copy unlike mtime.)

### Step 2: Filter

```bash
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
