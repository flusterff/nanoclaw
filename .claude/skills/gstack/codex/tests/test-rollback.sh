#!/usr/bin/env bash
# Full happy-path run, then --rollback; assert the revert chain lands.
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL="$THIS_DIR/../bin/codex-implement"
TMP="$(mktemp -d)"
SIM_PID=""
cleanup() {
  if [ -n "$SIM_PID" ]; then kill "$SIM_PID" 2>/dev/null || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

REPO="$TMP/repo"
mkdir -p "$REPO"
cd "$REPO" && git init -q && git config user.email t@t.t && git config user.name t
echo base > base.txt && git add base.txt && git commit -qm init
git checkout -qb main

mkdir -p "$TMP/stubs"

# Fake codex: parses -C <dir> and the last arg (prompt). If prompt mentions
# ra.txt / rb.txt, create + commit that file inside the worktree dir.
cat > "$TMP/stubs/codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
# Extract -C <dir>
WT=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-C" ]; then WT="$a"; fi
  prev="$a"
done
# Last arg is the prompt.
prompt=""
if [ "$#" -gt 0 ]; then
  # bash 3.2: use eval to grab final positional arg
  eval 'prompt=${'$#'}'
fi

if [ -n "$WT" ] && [ -d "$WT" ]; then
  cd "$WT"
  # Match only the file the task owns (Create: `FILE`), not forbidden-list mentions.
  if echo "$prompt" | grep -q 'Create: `ra.txt`'; then
    echo x > ra.txt
    git add ra.txt
    git -c user.email=t@t.t -c user.name=t commit -qm "fake ra.txt"
  fi
  if echo "$prompt" | grep -q 'Create: `rb.txt`'; then
    echo x > rb.txt
    git add rb.txt
    git -c user.email=t@t.t -c user.name=t commit -qm "fake rb.txt"
  fi
fi

echo DONE
EOF
chmod +x "$TMP/stubs/codex"

# Stub codex-gate-review sibling is not on PATH: codex-gate invokes the real
# sibling file by absolute path, which in turn runs `codex review`. We need
# to make codex review emit a clean pass output (no P0/P1/FAIL markers).
# The fake above exits DONE for plain invocations. codex-gate-review runs
# `codex review ...` — which will hit our stub and print "DONE" (no severity
# markers) → review returns PASS. Good.

export PATH="$TMP/stubs:$PATH"
export CODEX_COMPANION="$THIS_DIR/codex-companion-fake.mjs"
GSTACK_HOME="$TMP/.gstack"
export GSTACK_HOME

# Derive the slug the way codex-implement does.
_plan_path="$THIS_DIR/fixtures/rollback-plan.md"
_plan_abs="$(cd "$(dirname "$_plan_path")" && pwd)/$(basename "$_plan_path")"
_repo_id="$(cd "$REPO" && git rev-parse --show-toplevel | xargs basename)"
_hash="$(printf '%s' "$_plan_abs" | shasum -a 1 | cut -c1-8)"
WORK="$GSTACK_HOME/codex-work/${_repo_id}--rollback-plan--${_hash}"

# Background Claude-simulator: writes spec-check-result for every needs-spec-check
(
  while :; do
    for f in "$WORK"/needs-spec-check.*.json; do
      [ -r "$f" ] || continue
      result="$(echo "$f" | sed 's/needs-spec-check\./spec-check-result./')"
      printf '{"verdict":"PASS","findings_text":"ok","completed_at":"now"}\n' > "$result.tmp"
      mv "$result.tmp" "$result"
      rm -f "$f"
    done
    sleep 1
  done
) &
SIM_PID=$!

# Happy-path run
"$IMPL" --base main "$THIS_DIR/fixtures/rollback-plan.md"

git checkout -q main
test -r ra.txt || { echo "FAIL: ra.txt missing pre-rollback"; exit 1; }
test -r rb.txt || { echo "FAIL: rb.txt missing pre-rollback"; exit 1; }

pre_count="$(git rev-list --count main)"
[ "$pre_count" = "3" ] || { echo "FAIL: expected 3 commits, got $pre_count"; git log --oneline; exit 1; }

# Rollback
"$IMPL" --base main --rollback "$THIS_DIR/fixtures/rollback-plan.md"

test ! -e ra.txt || { echo "FAIL: ra.txt still present after rollback"; exit 1; }
test ! -e rb.txt || { echo "FAIL: rb.txt still present after rollback"; exit 1; }

post_count="$(git rev-list --count main)"
[ "$post_count" = "5" ] || { echo "FAIL: expected 5 commits after rollback, got $post_count"; exit 1; }

last2_log="$(git -C "$REPO" log --format='%s' -2)"
echo "$last2_log" | grep -q '^Revert' || { echo "FAIL: last 2 commits not reverts"; echo "$last2_log" | cat -A; git -C "$REPO" log --format='%s' -4; exit 1; }

test ! -d "$WORK" || { echo "FAIL: state dir not removed"; exit 1; }

echo "PASS: test-rollback"
