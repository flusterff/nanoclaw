#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$THIS_DIR/../bin/codex-gate-review"
FAKE="$THIS_DIR/codex-fake"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Case 1: review passes (no blocking issues)
# codex review outputs plain text (not JSONL), so fixtures are plain text
cat > "$TMP/r.txt" <<'EOF'
Review complete. No blocking issues found.
OK
EOF
echo "exit 0" > "$TMP/e"
CODEX_BIN="$FAKE" CODEX_FAKE_RESPONSES="$TMP/r.txt" CODEX_FAKE_EXIT_FILE="$TMP/e" \
  "$GATE" --worktree "$TMP" --base origin/main --findings-file "$TMP/findings.txt" \
  > "$TMP/out"
[ "$(cat "$TMP/out")" = "PASS" ] || { echo "FAIL case 1: $(cat $TMP/out)"; exit 1; }

# Case 2: review fails (P1 issue)
cat > "$TMP/r.txt" <<'EOF'
[P1] race condition in foo.ts:42
FAIL
EOF
CODEX_BIN="$FAKE" CODEX_FAKE_RESPONSES="$TMP/r.txt" CODEX_FAKE_EXIT_FILE="$TMP/e" \
  "$GATE" --worktree "$TMP" --base origin/main --findings-file "$TMP/findings.txt" \
  > "$TMP/out"
[ "$(cat "$TMP/out")" = "FAIL" ] || { echo "FAIL case 2"; exit 1; }
grep -q "P1" "$TMP/findings.txt" || { echo "FAIL: findings not written"; exit 1; }

echo "PASS: test-gate-review"
