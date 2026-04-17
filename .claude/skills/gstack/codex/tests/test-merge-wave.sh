#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
MERGE="$THIS_DIR/../bin/codex-merge-wave"
WTHELP="$THIS_DIR/../bin/codex-worktree"
STATEBIN="$THIS_DIR/../bin/codex-state"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cd "$TMP" && git init -q repo && cd repo
git config user.email t@t.t; git config user.name t
echo base > x.txt && git add x.txt && git commit -qm init
git checkout -qb basebranch

# The plan.json slug-based naming uses the basename of the work-dir as a plan
# slug; codex-worktree forms branches as codex/<plan-slug>/<task-slug>. Mirror
# that by placing the work dir under a path whose basename we control.
WORK="$TMP/workroot/myplan"; mkdir -p "$WORK"

"$WTHELP" setup "$WORK" alpha basebranch > /dev/null
(cd "$WORK/alpha" && echo a > a.txt && git add a.txt && git commit -qm "task 1")

"$WTHELP" setup "$WORK" beta basebranch > /dev/null
(cd "$WORK/beta" && echo b > b.txt && git add b.txt && git commit -qm "task 2")

cat > "$WORK/plan.json" <<'EOF'
{
  "goal": "test", "architecture": "n/a", "test_command": "true",
  "tasks": [
    {"num": 1, "slug": "alpha", "heading": "alpha", "files": ["a.txt"], "body": ""},
    {"num": 2, "slug": "beta",  "heading": "beta",  "files": ["b.txt"], "body": ""}
  ],
  "waves": [{"wave": 1, "tasks": [1, 2], "status": "in_progress"}]
}
EOF

# init state.json so codex-state set-task-commit etc. have a target.
"$STATEBIN" init "$WORK" \
  --plan-path "$WORK/plan.json" --plan-sha deadbeef \
  --base-ref basebranch --base-sha "$(cd "$TMP/repo" && git rev-parse HEAD)" \
  --waves "$(jq '.waves' "$WORK/plan.json")" \
  --tasks "$(jq '.tasks | map({num, slug})' "$WORK/plan.json")"

cd "$TMP/repo"
"$MERGE" --work-dir "$WORK" --wave 1 --base basebranch --plan-json "$WORK/plan.json"

git checkout -q basebranch
test -r a.txt || { echo "FAIL: a.txt missing"; exit 1; }
test -r b.txt || { echo "FAIL: b.txt missing"; exit 1; }

log="$(git log --format='%s' -2 | head -n 10)"
echo "$log" | head -n 1 | grep -q 'task 2: beta'  || { echo "FAIL: latest commit wrong"; echo "$log"; exit 1; }
echo "$log" | tail -n 1 | grep -q 'task 1: alpha' || { echo "FAIL: earlier commit wrong"; echo "$log"; exit 1; }

echo "PASS: test-merge-wave"
