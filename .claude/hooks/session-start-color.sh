#!/usr/bin/env bash
# SessionStart hook: auto-tag the session's color from a per-worktree config file.
# Reads `.claude/session-color` in the project dir (or cwd fallback) and writes the
# color into `.claude/.notify-state/<session_id>.color` so notify hooks pick it up.
# Silent if the config file doesn't exist.

set -euo pipefail

PAYLOAD="$(cat 2>/dev/null || echo '{}')"
SESSION_ID="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id","") or "")
except Exception: print("")' 2>/dev/null || echo "")"
CWD="$(printf '%s' "$PAYLOAD" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("cwd","") or "")
except Exception: print("")' 2>/dev/null || echo "")"

[[ -z "$SESSION_ID" ]] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-${CWD:-/Users/will/nanoclaw}}"
COLOR_CONFIG="${PROJECT_DIR}/.claude/session-color"
[[ -f "$COLOR_CONFIG" ]] || exit 0

COLOR="$(tr -d '[:space:]' < "$COLOR_CONFIG")"
[[ -z "$COLOR" ]] && exit 0

STATE_DIR="${PROJECT_DIR}/.claude/.notify-state"
mkdir -p "$STATE_DIR"
echo "$COLOR" > "${STATE_DIR}/${SESSION_ID}.color"

exit 0
