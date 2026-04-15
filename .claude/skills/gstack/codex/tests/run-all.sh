#!/usr/bin/env bash
# Run every test-*.sh under this directory; fail on first error.
set -euo pipefail

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
failed=0
total=0
for t in "$THIS_DIR"/test-*.sh; do
  [ -r "$t" ] || continue
  total=$((total + 1))
  printf '=== %s ===\n' "$(basename "$t")"
  if ! bash "$t"; then
    failed=$((failed + 1))
    printf '!!! FAILED: %s\n' "$(basename "$t")"
  fi
done
printf 'summary: %d/%d passed\n' "$((total - failed))" "$total"
[ "$failed" -eq 0 ]
