#!/usr/bin/env bash
# Run every test-*.sh under this directory. Fails on:
#   - any test's non-zero exit
#   - any test that exits 0 without emitting "^PASS:" on stdout (silent-hang / silent-skip)
#   - any test that exceeds $TEST_TIMEOUT (default 180s) — set TEST_TIMEOUT=N to tune
# Pre-flight: rejects running if any test that exercises the orchestrator
#   (codex-implement / codex-run-wave) doesn't export CODEX_COMPANION.
set -euo pipefail

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_TIMEOUT="${TEST_TIMEOUT:-180}"

# --- Pre-flight ---
# Any test that invokes the orchestrator must export CODEX_COMPANION so
# dispatch resolves the fake, not the real plugin. Skip the fake self-test
# and the dispatch unit test (which control CODEX_COMPANION per case).
preflight_fail=0
for t in "$THIS_DIR"/test-*.sh; do
  [ -r "$t" ] || continue
  case "$(basename "$t")" in
    test-codex-fake.sh|test-codex-companion-fake.sh|test-dispatch-task.sh) continue ;;
  esac
  if grep -qE 'codex-implement|codex-run-wave' "$t" && \
     ! grep -q 'export CODEX_COMPANION' "$t"; then
    printf '!!! PREFLIGHT FAIL: %s exercises the orchestrator but does not export CODEX_COMPANION\n' \
      "$(basename "$t")" >&2
    preflight_fail=$((preflight_fail + 1))
  fi
done
if [ "$preflight_fail" -gt 0 ]; then
  printf 'preflight failed (%d tests missing CODEX_COMPANION export)\n' "$preflight_fail" >&2
  exit 2
fi

# --- Timeout wrapper ---
if command -v timeout >/dev/null 2>&1; then
  TO_CMD=(timeout "$TEST_TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then
  TO_CMD=(gtimeout "$TEST_TIMEOUT")
else
  TO_CMD=()
fi

# --- Run every test ---
failed=0
total=0
for t in "$THIS_DIR"/test-*.sh; do
  [ -r "$t" ] || continue
  total=$((total + 1))
  name="$(basename "$t")"
  printf '=== %s ===\n' "$name"

  tmp_out="$(mktemp)"
  if "${TO_CMD[@]+"${TO_CMD[@]}"}" bash "$t" > "$tmp_out" 2>&1; then
    cat "$tmp_out"
    if ! grep -q '^PASS:' "$tmp_out"; then
      printf '!!! SILENT PASS: %s exited 0 but did not print "PASS:" marker\n' "$name" >&2
      failed=$((failed + 1))
    fi
  else
    rc=$?
    cat "$tmp_out"
    if [ "$rc" -eq 124 ]; then
      printf '!!! TIMEOUT (%ss): %s\n' "$TEST_TIMEOUT" "$name" >&2
    else
      printf '!!! FAILED (rc=%d): %s\n' "$rc" "$name" >&2
    fi
    failed=$((failed + 1))
  fi
  rm -f "$tmp_out"
done
printf 'summary: %d/%d passed\n' "$((total - failed))" "$total"
[ "$failed" -eq 0 ]
