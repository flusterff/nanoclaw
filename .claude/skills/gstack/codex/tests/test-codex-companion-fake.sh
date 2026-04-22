#!/usr/bin/env bash
# Test: codex-companion-fake.mjs returns scripted payloads and delegates to $CODEX_BIN.
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
FAKE="$THIS_DIR/codex-companion-fake.mjs"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Case A: payload mode — fake emits the given JSON verbatim.
cat > "$TMP/payload.json" <<'EOF'
{"status":0,"threadId":"test-abc","rawOutput":"DONE","touchedFiles":[],"reasoningSummary":[]}
EOF

CODEX_COMPANION_FAKE_PAYLOAD="$TMP/payload.json" \
  node "$FAKE" task --fresh --json --prompt-file /dev/null > "$TMP/out.json"
diff "$TMP/payload.json" "$TMP/out.json" || { echo "FAIL case A: payload not forwarded verbatim"; exit 1; }

# Case B: subprocess-delegation mode — fake wraps $CODEX_BIN stdout as plugin JSON.
cat > "$TMP/fake-codex" <<'SCRIPT'
#!/usr/bin/env bash
# Trivial stub: echo DONE, exit 0.
echo "task complete"
echo "DONE"
exit 0
SCRIPT
chmod +x "$TMP/fake-codex"

echo "hello prompt" > "$TMP/prompt.txt"

CODEX_BIN="$TMP/fake-codex" \
  node "$FAKE" task --fresh --json --prompt-file "$TMP/prompt.txt" > "$TMP/out-b.json"

status_b="$(jq -r '.status' "$TMP/out-b.json")"
raw_b="$(jq -r '.rawOutput' "$TMP/out-b.json")"
[ "$status_b" = "0" ] || { echo "FAIL case B: expected status=0, got $status_b"; exit 1; }
echo "$raw_b" | grep -q "DONE" || { echo "FAIL case B: rawOutput missing DONE: $raw_b"; exit 1; }

# Case C: fail-loud mode — no $CODEX_BIN, PATH has no codex, fake emits status=1.
# Resolve node's absolute path up front so PATH override doesn't break the launch itself.
NODE_BIN="$(command -v node)"
mkdir -p "$TMP/empty-path"
( unset CODEX_BIN; PATH="$TMP/empty-path" \
    "$NODE_BIN" "$FAKE" task --fresh --json --prompt-file "$TMP/prompt.txt" > "$TMP/out-c.json" )
status_c="$(jq -r '.status' "$TMP/out-c.json")"
[ "$status_c" = "1" ] || { echo "FAIL case C: expected status=1 when no codex resolves, got $status_c"; exit 1; }

# Case D: subprocess nonzero exit propagates as status=1.
cat > "$TMP/failing-codex" <<'SCRIPT'
#!/usr/bin/env bash
echo "explode"
exit 17
SCRIPT
chmod +x "$TMP/failing-codex"

CODEX_BIN="$TMP/failing-codex" \
  node "$FAKE" task --fresh --json --prompt-file "$TMP/prompt.txt" > "$TMP/out-d.json"
status_d="$(jq -r '.status' "$TMP/out-d.json")"
[ "$status_d" = "1" ] || { echo "FAIL case D: expected status=1 on subprocess nonzero, got $status_d"; exit 1; }

echo "PASS: test-codex-companion-fake (payload + delegation + fail-loud)"
