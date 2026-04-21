#!/usr/bin/env bash
# Regression for the awk gsub(&) bug: if a plan's task body or test command
# contains `&` (e.g. `&&` in a shell pipeline), the old render_prompt awk
# script inserted the matched placeholder back into the replacement because
# `&` in gsub's replacement means "the matched pattern". The rendered prompt
# then contained literal `{{TASK_BODY}}{{TASK_BODY}}` instead of `&&`.
#
# This test runs codex-implement end-to-end against a plan full of `&&` and
# asserts the rendered prompt file contains the original shell-pipe text
# (not any {{PLACEHOLDER}} leak).
set -euo pipefail

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL="$THIS_DIR/../bin/codex-implement"
FAKE="$THIS_DIR/codex-fake"
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

# Plan body and test command both contain `&&` — the awk gsub(&) bug
# expanded each `&` to the matched placeholder, producing literal
# `{{TASK_BODY}}{{TASK_BODY}}` in the rendered prompt.
cat > "$TMP/plan-amp.md" <<'EOF'
# Ampersand Regression Plan

**Goal:** verify the ampersand && survives render_prompt awk substitution.

**Architecture:** single wave, single task, body contains the ampersand &&.

**Test command:** `test -r a.txt && grep -q alpha a.txt`

## Parallelization

- Wave 1: Task 1

### Task 1: alpha with ampersand

**Files:**
- Create: `a.txt`

- [ ] **Step 1: write alpha && commit**

Run: `echo alpha > a.txt && git add a.txt`
EOF

# Fake codex: just create a.txt and exit DONE. No committing — the orchestrator
# auto-commits now. (bug #2 regression is covered separately by test-e2e.)
mkdir -p "$TMP/stubs"
cat > "$TMP/stubs/codex" <<'EOF'
#!/usr/bin/env bash
WT=""
prev=""
for a in "$@"; do
  if [ "$prev" = "-C" ]; then WT="$a"; fi
  prev="$a"
done
if [ -n "$WT" ] && [ -d "$WT" ]; then
  cd "$WT"
  echo alpha > a.txt
fi
echo DONE
EOF
chmod +x "$TMP/stubs/codex"
export PATH="$TMP/stubs:$PATH"

GSTACK_HOME="$TMP/.gstack"
export GSTACK_HOME
# Match the slug produced by codex-implement: <repo-id>--<plan-base>--<path-hash>.
_plan_abs="$(cd "$(dirname "$TMP/plan-amp.md")" && pwd)/plan-amp.md"
_repo_id="$(cd "$REPO" && git rev-parse --show-toplevel | xargs basename)"
_hash="$(printf '%s' "$_plan_abs" | shasum -a 1 | cut -c1-8)"
WORK="$GSTACK_HOME/codex-work/${_repo_id}--plan-amp--${_hash}"

# Claude simulator writes PASS spec-check result
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

"$IMPL" --base main "$TMP/plan-amp.md"

# The rendered prompt file is deterministic:
prompt="$WORK/prompt.1.1.txt"
[ -r "$prompt" ] || { echo "FAIL: rendered prompt not found at $prompt"; exit 1; }

# Must NOT contain any remaining placeholder leak caused by & mis-interpretation.
if grep -q '{{TASK_BODY}}' "$prompt"; then
  echo "FAIL: rendered prompt contains leaked {{TASK_BODY}}:"
  grep -n '{{TASK_BODY}}' "$prompt"
  exit 1
fi
if grep -q '{{TEST_COMMAND}}' "$prompt"; then
  echo "FAIL: rendered prompt contains leaked {{TEST_COMMAND}}"
  grep -n '{{TEST_COMMAND}}' "$prompt"
  exit 1
fi

# Must contain the literal `&&` from both the body and the test_command.
grep -q 'echo alpha > a.txt && git add a.txt' "$prompt" || {
  echo "FAIL: task body '&&' did not survive substitution"
  grep -n 'a.txt' "$prompt" || true
  exit 1
}
# The task's own Run: line becomes its test_command (per-task overrides plan-level).
# Both that and the PLAN_GOAL/ARCHITECTURE lines contain `&&` and must survive.
grep -q 'PLAN GOAL: verify the ampersand && survives' "$prompt" || {
  echo "FAIL: plan goal '&&' did not survive substitution"
  exit 1
}
grep -q 'On completion, run: echo alpha > a.txt && git add a.txt' "$prompt" || {
  echo "FAIL: test_command '&&' did not survive substitution"
  exit 1
}

echo "PASS: test-render-prompt-ampersand"
