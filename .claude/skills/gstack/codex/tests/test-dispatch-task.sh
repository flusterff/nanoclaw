#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
DISPATCH="$THIS_DIR/../bin/codex-dispatch-task"
FAKE_COMPANION="$THIS_DIR/codex-companion-fake.mjs"
FAKE_BIN="$THIS_DIR/codex-fake"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

WT="$TMP/wt"; mkdir -p "$WT"; (cd "$WT" && git init -q && git commit -q --allow-empty -m init)
LOGDIR="$TMP/logs"; mkdir -p "$LOGDIR"

# Case A: DONE path — fake companion returns status:0 + rawOutput "DONE".
cat > "$TMP/payload.done.json" <<'EOF'
{"status":0,"threadId":"t-done","rawOutput":"all good\nDONE","touchedFiles":[],"reasoningSummary":["step a","step b"]}
EOF

CODEX_COMPANION="$FAKE_COMPANION" \
CODEX_COMPANION_FAKE_PAYLOAD="$TMP/payload.done.json" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/a.log" \
    --prompt-file <(echo "minimal prompt") \
    --reasoning high \
    --session-file "$TMP/a.sid" \
  > "$TMP/a.out"

status="$(cat "$TMP/a.out")"
[ "$status" = "DONE" ] || { echo "FAIL A: status=$status expected DONE"; exit 1; }
[ -r "$LOGDIR/a.log" ] || { echo "FAIL A: log not written"; exit 1; }
grep -q '"threadId": "t-done"\|"threadId":"t-done"' "$LOGDIR/a.log" || { echo "FAIL A: log missing threadId"; exit 1; }
[ "$(cat "$TMP/a.sid")" = "t-done" ] || { echo "FAIL A: sid_file expected t-done, got $(cat "$TMP/a.sid")"; exit 1; }

# Case B: BLOCKED path — dispatch writes synthetic findings to --findings-out.
cat > "$TMP/payload.blocked.json" <<'EOF'
{"status":0,"threadId":"t-blk","rawOutput":"need clarification\nBLOCKED","touchedFiles":[],"reasoningSummary":["reason 1"]}
EOF

CODEX_COMPANION="$FAKE_COMPANION" \
CODEX_COMPANION_FAKE_PAYLOAD="$TMP/payload.blocked.json" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/b.log" \
    --prompt-file <(echo "minimal prompt") \
    --reasoning high \
    --session-file "$TMP/b.sid" \
    --findings-out "$TMP/b.findings.txt" \
  > "$TMP/b.out"

status="$(cat "$TMP/b.out")"
[ "$status" = "BLOCKED" ] || { echo "FAIL B: status=$status expected BLOCKED"; exit 1; }
[ -r "$TMP/b.findings.txt" ] || { echo "FAIL B: findings file not written"; exit 1; }
grep -q "BLOCKED" "$TMP/b.findings.txt" || { echo "FAIL B: findings missing BLOCKED context"; exit 1; }
grep -q "reason 1" "$TMP/b.findings.txt" || { echo "FAIL B: findings missing reasoning"; exit 1; }

# Case C: PLUGIN_ERROR path — plugin status:1.
cat > "$TMP/payload.fail.json" <<'EOF'
{"status":1,"threadId":"t-fail","rawOutput":"","touchedFiles":[],"reasoningSummary":[]}
EOF

CODEX_COMPANION="$FAKE_COMPANION" \
CODEX_COMPANION_FAKE_PAYLOAD="$TMP/payload.fail.json" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/c.log" \
    --prompt-file <(echo "minimal prompt") \
    --reasoning high \
    --session-file "$TMP/c.sid" \
  > "$TMP/c.out"

status="$(cat "$TMP/c.out")"
[ "$status" = "PLUGIN_ERROR" ] || { echo "FAIL C: status=$status expected PLUGIN_ERROR"; exit 1; }
[ "$(cat "$TMP/c.sid")" = "t-fail" ] || { echo "FAIL C: sid_file should record threadId even on failed turn, got $(cat "$TMP/c.sid")"; exit 1; }

# Case D: missing plugin — fake HOME has no installed_plugins.json; CODEX_COMPANION unset.
# We intentionally keep real PATH here (dispatch uses mkdir/jq/dirname) and
# only swap $HOME so the plugin lookup fails cleanly.
mkdir -p "$TMP/fake-home/.claude/plugins"
echo '{"version":2,"plugins":{}}' > "$TMP/fake-home/.claude/plugins/installed_plugins.json"
( unset CODEX_COMPANION; HOME="$TMP/fake-home" \
    "$DISPATCH" \
      --worktree "$WT" \
      --log "$LOGDIR/d.log" \
      --prompt-file <(echo "minimal prompt") \
      --reasoning high \
      --session-file "$TMP/d.sid" \
    > "$TMP/d.out" 2> "$TMP/d.err" || true )

status="$(cat "$TMP/d.out")"
[ "$status" = "PLUGIN_ERROR" ] || { echo "FAIL D: status=$status expected PLUGIN_ERROR for missing plugin"; exit 1; }
grep -q "codex-plugin-cc not installed" "$TMP/d.err" || { echo "FAIL D: stderr missing install guidance"; exit 1; }
grep -q "PLUGIN_ERROR: codex-plugin-cc not installed" "$LOGDIR/d.log" || { echo "FAIL D: log missing install guidance"; exit 1; }

# Case E: auto-commit preserved — worktree changes get committed on DONE.
cat > "$TMP/payload.commit.json" <<'EOF'
{"status":0,"threadId":"t-commit","rawOutput":"DONE","touchedFiles":["test.txt"],"reasoningSummary":[]}
EOF

# Seed an uncommitted change in the worktree (simulating codex's edits).
echo "new content" > "$WT/test.txt"

CODEX_COMPANION="$FAKE_COMPANION" \
CODEX_COMPANION_FAKE_PAYLOAD="$TMP/payload.commit.json" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/e.log" \
    --prompt-file <(echo "minimal prompt") \
    --reasoning high \
    --session-file "$TMP/e.sid" \
  > "$TMP/e.out"

# Verify the new file got committed by the dispatch script.
(cd "$WT" && git log --oneline | head -3 | grep -q "codex task: auto-commit") || {
  echo "FAIL E: auto-commit did not run on DONE"; exit 1;
}

# Case F: regression — timeout with partial stdout must emit PLUGIN_ERROR.
# A naive `[ rc=124 ] || [ rc!=0 ] && [ !s stdout ]` precedence bug would
# skip PLUGIN_ERROR when the plugin wrote any stdout before timeout.
cat > "$TMP/slow-fake.sh" <<'SCRIPT'
#!/usr/bin/env bash
# Write some stdout immediately, then sleep past the dispatch timeout.
echo '{"status":0,"threadId":"t-slow","rawOutput":"partial","touchedFiles":[],"reasoningSummary":[]}'
sleep 30
SCRIPT
chmod +x "$TMP/slow-fake.sh"

CODEX_COMPANION="$TMP/slow-fake.sh" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/f.log" \
    --prompt-file <(echo "minimal prompt") \
    --reasoning high \
    --session-file "$TMP/f.sid" \
    --timeout 2 \
  > "$TMP/f.out"

status="$(cat "$TMP/f.out")"
[ "$status" = "PLUGIN_ERROR" ] || { echo "FAIL F: timeout-with-partial-stdout should be PLUGIN_ERROR, got $status"; exit 1; }
grep -q "dispatch timeout" "$LOGDIR/f.log" || { echo "FAIL F: log missing timeout attribution"; exit 1; }

# Case G: regression — missing-plugin path must truncate SID_FILE so the
# PRIOR attempt's threadId doesn't leak into state.json as THIS attempt's.
echo "stale-prior-thread-id" > "$TMP/g.sid"

( unset CODEX_COMPANION; HOME="$TMP/fake-home" \
    "$DISPATCH" \
      --worktree "$WT" \
      --log "$LOGDIR/g.log" \
      --prompt-file <(echo "minimal prompt") \
      --reasoning high \
      --session-file "$TMP/g.sid" \
    > "$TMP/g.out" 2> "$TMP/g.err" || true )

status="$(cat "$TMP/g.out")"
[ "$status" = "PLUGIN_ERROR" ] || { echo "FAIL G: status=$status expected PLUGIN_ERROR"; exit 1; }
if [ -s "$TMP/g.sid" ]; then
  echo "FAIL G: sid file still contains '$(cat "$TMP/g.sid")' — stale threadId leaked past missing-plugin exit"
  exit 1
fi

echo "PASS: test-dispatch-task (all cases)"
