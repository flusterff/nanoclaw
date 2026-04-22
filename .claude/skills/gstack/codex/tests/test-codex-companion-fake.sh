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

# Verify exact match (fake should emit file contents verbatim)
diff "$TMP/payload.json" "$TMP/out.json" || { echo "FAIL: payload not forwarded verbatim"; exit 1; }

echo "PASS: test-codex-companion-fake (payload mode)"
