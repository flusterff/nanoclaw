#!/usr/bin/env bash
# Test: codex-fake reads scripted JSONL responses from CODEX_FAKE_RESPONSES
# and emits them on stdout, exiting with the scripted code.
set -euo pipefail

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
FAKE="$THIS_DIR/codex-fake"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Case 1: scripted success
cat > "$TMP/responses.jsonl" <<'EOF'
{"type":"message","text":"working..."}
{"type":"final","status":"DONE","message":"task complete"}
EOF
echo "exit 0" > "$TMP/exit"

CODEX_FAKE_RESPONSES="$TMP/responses.jsonl" CODEX_FAKE_EXIT_FILE="$TMP/exit" \
  "$FAKE" exec --json "any prompt" > "$TMP/out.jsonl"

grep -q '"status":"DONE"' "$TMP/out.jsonl" || { echo "FAIL: DONE not emitted"; exit 1; }

# Case 2: scripted failure
echo "exit 1" > "$TMP/exit"
cat > "$TMP/responses.jsonl" <<'EOF'
{"type":"final","status":"BLOCKED","message":"stuck"}
EOF

if CODEX_FAKE_RESPONSES="$TMP/responses.jsonl" CODEX_FAKE_EXIT_FILE="$TMP/exit" \
     "$FAKE" exec --json "p" > "$TMP/out.jsonl"; then
  echo "FAIL: expected non-zero exit"; exit 1
fi
grep -q '"status":"BLOCKED"' "$TMP/out.jsonl" || { echo "FAIL: BLOCKED not emitted"; exit 1; }

echo "PASS: test-codex-fake"
