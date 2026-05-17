#!/usr/bin/env bash
# SessionStart hook: auto-tag the session's color from a per-worktree config file.
# Reads `.claude/session-color` in the project dir and writes the color into
# `.claude/.notify-state/<session_id>.color` so notify hooks pick it up.
# Silent if the config file doesn't exist.
#
# Resolution order for project dir:
#   1. $CLAUDE_PROJECT_DIR (set by Claude Code in some hook contexts)
#   2. git toplevel of $CWD (handles Claude launched from a subdirectory —
#      otherwise CWD points at the subdir and .claude/session-color is missed)
#   3. $CWD itself
# No hardcoded path fallback — this hook is intended to be shareable across
# any clone, so it must work without machine-specific defaults.

set -euo pipefail

PAYLOAD="$(cat 2>/dev/null || echo '{}')"
SESSION_ID="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id","") or "")
except Exception: print("")' 2>/dev/null || echo "")"
CWD="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("cwd","") or "")
except Exception: print("")' 2>/dev/null || echo "")"

[[ -z "$SESSION_ID" ]] && exit 0

# Resolve PROJECT_DIR. Try git toplevel of CWD so launching Claude from a
# subdirectory still finds the per-worktree session-color file at the root.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-}"
if [[ -z "$PROJECT_DIR" && -n "$CWD" && -d "$CWD" ]]; then
  PROJECT_DIR=$(cd "$CWD" 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null || echo "$CWD")
fi
[[ -z "$PROJECT_DIR" ]] && exit 0

COLOR_CONFIG="${PROJECT_DIR}/.claude/session-color"
[[ -f "$COLOR_CONFIG" ]] || exit 0

COLOR="$(tr -d '[:space:]' < "$COLOR_CONFIG")"
[[ -z "$COLOR" ]] && exit 0

STATE_DIR="${PROJECT_DIR}/.claude/.notify-state"
mkdir -p "$STATE_DIR"
echo "$COLOR" > "${STATE_DIR}/${SESSION_ID}.color"

exit 0
