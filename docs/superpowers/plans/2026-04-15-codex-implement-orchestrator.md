# `/codex implement` Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/codex implement <plan-file>` 4th mode of the existing `/codex` skill — a plan orchestrator that runs superpowers-style implementation plans in parallel waves via `codex exec -s workspace-write`, with per-task git worktrees, three-stage merge gate, retry ladder with Claude fallback, and resume-from-checkpoint state.

**Architecture:** Two-layer control flow. Bash helpers under `.claude/skills/gstack/codex/bin/` do the plumbing: plan parsing, worktree lifecycle, `codex exec` dispatch, gate runs, squash-merge. Claude (the coordinating session) reads state.json between phases and dispatches Task() subagents for Stage 3 spec checks and attempt-4 Claude fallbacks. The two layers synchronize through `state.json` and per-task marker files (`needs-spec-check.json`, `needs-claude-fallback.json`).

**Tech Stack:** bash 5+, jq, Git ≥ 2.5 (worktrees), `flock` (util-linux or macOS `shlock`), OpenAI Codex CLI (`codex exec`, `codex review`, `codex exec resume`), `bats` (optional, for structured shell tests).

**Spec:** [`docs/superpowers/specs/2026-04-15-codex-implement-orchestrator-design.md`](../specs/2026-04-15-codex-implement-orchestrator-design.md)

**Test command:** `.claude/skills/gstack/codex/tests/run-all.sh`

---

## Parallelization

- Wave 1: Tasks 1, 2, 3, 4
- Wave 2: Tasks 5, 6, 7
- Wave 3: Task 8
- Wave 4: Tasks 9, 10
- Wave 5: Tasks 11, 12, 13, 14

---

## File Structure

**New files:**
- `.claude/skills/gstack/codex/bin/codex-implement` — entry point dispatched by SKILL.md Step 2D
- `.claude/skills/gstack/codex/bin/codex-parse-plan` — plan parser, emits JSON to stdout
- `.claude/skills/gstack/codex/bin/codex-state` — state.json read/write with flock + atomic rename
- `.claude/skills/gstack/codex/bin/codex-worktree` — worktree setup/teardown helpers
- `.claude/skills/gstack/codex/bin/codex-dispatch-task` — single-task `codex exec` wrapper
- `.claude/skills/gstack/codex/bin/codex-gate` — three-stage gate loop + retry ladder
- `.claude/skills/gstack/codex/bin/codex-run-wave` — parallel wave dispatcher
- `.claude/skills/gstack/codex/bin/codex-merge-wave` — squash-merge wave tasks into base
- `.claude/skills/gstack/codex/codex-implementer-prompt.md` — Codex task prompt template
- `.claude/skills/gstack/codex/spec-reviewer-prompt.md` — Claude spec-check subagent prompt
- `.claude/skills/gstack/codex/codex-fallback-prompt.md` — Claude attempt-4 fallback prompt
- `.claude/skills/gstack/codex/tests/codex-fake` — codex CLI shim for integration tests
- `.claude/skills/gstack/codex/tests/fixtures/*.md` — sample plan files
- `.claude/skills/gstack/codex/tests/test-*.sh` — shell test files
- `.claude/skills/gstack/codex/tests/run-all.sh` — test runner

**Modified files:**
- `.claude/skills/gstack/codex/SKILL.md` — add Step 2D: Implement Mode, bump "three modes" → "four modes" in description
- `.claude/skills/gstack/codex/SKILL.md.tmpl` — mirror SKILL.md changes
- `CLAUDE.md` — one-line note under the codex skill reference

---

### Task 1: Scaffolding + fake codex shim

**Files:**
- Create: `.claude/skills/gstack/codex/bin/.gitkeep`
- Create: `.claude/skills/gstack/codex/tests/codex-fake`
- Create: `.claude/skills/gstack/codex/tests/fixtures/.gitkeep`
- Create: `.claude/skills/gstack/codex/tests/run-all.sh`
- Create: `.claude/skills/gstack/codex/tests/test-codex-fake.sh`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p .claude/skills/gstack/codex/bin
mkdir -p .claude/skills/gstack/codex/tests/fixtures
touch .claude/skills/gstack/codex/bin/.gitkeep
touch .claude/skills/gstack/codex/tests/fixtures/.gitkeep
```

- [ ] **Step 2: Write the failing test for `codex-fake`**

Create `.claude/skills/gstack/codex/tests/test-codex-fake.sh`:

```bash
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
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
chmod +x .claude/skills/gstack/codex/tests/test-codex-fake.sh
.claude/skills/gstack/codex/tests/test-codex-fake.sh
```
Expected: FAIL with "No such file or directory" on codex-fake.

- [ ] **Step 4: Implement `codex-fake`**

Create `.claude/skills/gstack/codex/tests/codex-fake`:

```bash
#!/usr/bin/env bash
# A scripted stand-in for `codex` CLI used in integration tests.
# Env:
#   CODEX_FAKE_RESPONSES  — path to a JSONL file whose contents are written to stdout
#   CODEX_FAKE_EXIT_FILE  — path to a file whose single line `exit N` controls our exit code
#   CODEX_FAKE_LOG        — optional path; if set, we append the full argv to it per call
set -euo pipefail

if [ -n "${CODEX_FAKE_LOG:-}" ]; then
  printf '%s\n' "argv: $*" >> "$CODEX_FAKE_LOG"
fi

if [ -n "${CODEX_FAKE_RESPONSES:-}" ] && [ -r "${CODEX_FAKE_RESPONSES}" ]; then
  cat "${CODEX_FAKE_RESPONSES}"
fi

if [ -n "${CODEX_FAKE_EXIT_FILE:-}" ] && [ -r "${CODEX_FAKE_EXIT_FILE}" ]; then
  # file should contain a single line like: exit N
  code="$(awk '/^exit/{print $2; exit}' "${CODEX_FAKE_EXIT_FILE}")"
  exit "${code:-0}"
fi

exit 0
```

- [ ] **Step 5: Make it executable and verify test passes**

```bash
chmod +x .claude/skills/gstack/codex/tests/codex-fake
.claude/skills/gstack/codex/tests/test-codex-fake.sh
```
Expected: PASS: test-codex-fake

- [ ] **Step 6: Create `run-all.sh`**

Create `.claude/skills/gstack/codex/tests/run-all.sh`:

```bash
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
```

```bash
chmod +x .claude/skills/gstack/codex/tests/run-all.sh
.claude/skills/gstack/codex/tests/run-all.sh
```
Expected: `summary: 1/1 passed`

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/gstack/codex/bin/.gitkeep \
        .claude/skills/gstack/codex/tests/
git commit -m "codex-implement: scaffolding + fake codex shim for tests"
```

---

### Task 2: Plan parser (`codex-parse-plan`)

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-parse-plan`
- Create: `.claude/skills/gstack/codex/tests/fixtures/happy.md`
- Create: `.claude/skills/gstack/codex/tests/fixtures/no-parallelization.md`
- Create: `.claude/skills/gstack/codex/tests/fixtures/duplicate-task-ref.md`
- Create: `.claude/skills/gstack/codex/tests/fixtures/missing-task-ref.md`
- Create: `.claude/skills/gstack/codex/tests/fixtures/overlapping-files.md`
- Create: `.claude/skills/gstack/codex/tests/test-parse-plan.sh`

- [ ] **Step 1: Write the fixture plans**

Create `.claude/skills/gstack/codex/tests/fixtures/happy.md`:

````markdown
# Sample Plan

**Goal:** test fixture for the parser.

**Architecture:** n/a.

**Test command:** `echo global-test`

## Parallelization

- Wave 1: Tasks 1, 2
- Wave 2: Task 3

### Task 1: alpha

**Files:**
- Create: `a.txt`

- [ ] **Step 1: Do something**

Run: `echo a`

### Task 2: beta

**Files:**
- Create: `b.txt`

- [ ] **Step 1: Do other thing**

Run: `echo b`

### Task 3: gamma

**Files:**
- Modify: `a.txt`

- [ ] **Step 1: Final step**

Run: `echo g`
````

Create `.claude/skills/gstack/codex/tests/fixtures/no-parallelization.md`:

````markdown
# No Parallelization Plan

**Goal:** tests serial fallback.

**Architecture:** n/a.

**Test command:** `true`

### Task 1: only

**Files:**
- Create: `x.txt`

- [ ] **Step 1: single**

Run: `true`
````

Create `.claude/skills/gstack/codex/tests/fixtures/duplicate-task-ref.md`:

````markdown
# Duplicate Ref Plan

**Test command:** `true`

## Parallelization

- Wave 1: Tasks 1, 1

### Task 1: only

**Files:**
- Create: `x.txt`

- [ ] Step
````

Create `.claude/skills/gstack/codex/tests/fixtures/missing-task-ref.md`:

````markdown
# Missing Ref Plan

**Test command:** `true`

## Parallelization

- Wave 1: Task 1

### Task 1: a

**Files:**
- Create: `x.txt`

- [ ] Step

### Task 2: b

**Files:**
- Create: `y.txt`

- [ ] Step
````

Create `.claude/skills/gstack/codex/tests/fixtures/overlapping-files.md`:

````markdown
# Overlapping Files Plan

**Test command:** `true`

## Parallelization

- Wave 1: Tasks 1, 2

### Task 1: a

**Files:**
- Modify: `shared.txt`

- [ ] Step

### Task 2: b

**Files:**
- Modify: `shared.txt`

- [ ] Step
````

- [ ] **Step 2: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-parse-plan.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
PARSER="$THIS_DIR/../bin/codex-parse-plan"
FIX="$THIS_DIR/fixtures"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Happy path
"$PARSER" "$FIX/happy.md" > "$TMP/happy.json"
# shape assertions via jq
jq -e '.goal == "test fixture for the parser."' "$TMP/happy.json" > /dev/null
jq -e '.test_command == "echo global-test"' "$TMP/happy.json" > /dev/null
jq -e '.tasks | length == 3' "$TMP/happy.json" > /dev/null
jq -e '.waves | length == 2' "$TMP/happy.json" > /dev/null
jq -e '.waves[0].tasks == [1,2]' "$TMP/happy.json" > /dev/null
jq -e '.waves[1].tasks == [3]' "$TMP/happy.json" > /dev/null
jq -e '.tasks[0].slug == "alpha"' "$TMP/happy.json" > /dev/null
jq -e '.tasks[0].files == ["a.txt"]' "$TMP/happy.json" > /dev/null

# No Parallelization — falls back to serial, exit 0 with warning on stderr
"$PARSER" "$FIX/no-parallelization.md" > "$TMP/np.json" 2> "$TMP/np.err"
grep -q "WARNING.*Parallelization" "$TMP/np.err" || { echo "FAIL: no warning"; exit 1; }
jq -e '.waves == [{"wave":1,"tasks":[1]}]' "$TMP/np.json" > /dev/null

# Duplicate ref — hard error
if "$PARSER" "$FIX/duplicate-task-ref.md" > /dev/null 2> "$TMP/err"; then
  echo "FAIL: expected exit != 0"; exit 1
fi
grep -q "duplicate" "$TMP/err" || { echo "FAIL: bad error msg"; exit 1; }

# Missing ref — hard error
if "$PARSER" "$FIX/missing-task-ref.md" > /dev/null 2> "$TMP/err"; then
  echo "FAIL: expected exit != 0"; exit 1
fi
grep -q "not referenced" "$TMP/err" || { echo "FAIL: bad error msg"; exit 1; }

# Overlapping files — hard error
if "$PARSER" "$FIX/overlapping-files.md" > /dev/null 2> "$TMP/err"; then
  echo "FAIL: expected exit != 0"; exit 1
fi
grep -q "overlapping" "$TMP/err" || { echo "FAIL: bad error msg"; exit 1; }

echo "PASS: test-parse-plan"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-parse-plan.sh
.claude/skills/gstack/codex/tests/test-parse-plan.sh
```
Expected: FAIL — parser missing.

- [ ] **Step 3: Implement the parser**

Create `.claude/skills/gstack/codex/bin/codex-parse-plan`:

```bash
#!/usr/bin/env bash
# Parse a superpowers-format implementation plan.
# Emits a JSON object on stdout describing goal, architecture, test_command,
# tasks (with slug + files + body), and waves.
# Hard-errors (exit 2) on: duplicate task ref, missing task ref, overlapping
# file claims within a wave, malformed task heading.
# Soft-warns (stderr) + serial fallback when ## Parallelization is missing.
set -euo pipefail

if [ $# -lt 1 ] || [ ! -r "$1" ]; then
  echo "usage: codex-parse-plan <plan.md>" >&2
  exit 2
fi
PLAN="$1"

slugify() {
  tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'
}

extract_header() {
  # $1 = field label like "Goal" or "Test command"
  awk -v label="$1" '
    BEGIN { IGNORECASE=1; re="^\\*\\*" label ":\\*\\* *" }
    $0 ~ re {
      sub(re, "", $0); print; exit
    }
  ' "$PLAN"
}

# --- extract header fields ---
goal="$(extract_header "Goal")"
architecture="$(extract_header "Architecture")"
test_command="$(extract_header "Test command")"

# --- extract tasks ---
# split plan by "### Task N: ..." — capture number, heading, body.
tasks_json="$(awk '
  BEGIN { in_task=0; num=0; printf "["; sep="" }
  /^### Task [0-9]+:/ {
    if (in_task) {
      printf "%s{\"num\":%d,\"heading\":%s,\"body\":%s}", sep, num, hj, bj
      sep=","
    }
    match($0, /^### Task ([0-9]+): *(.*)$/, m); num=m[1]+0; head=m[2]
    hj="\"" head "\""
    body=""; in_task=1; next
  }
  /^## / && in_task {
    # end of task region when a non-task H2 starts
    printf "%s{\"num\":%d,\"heading\":%s,\"body\":%s}", sep, num, hj, bj
    sep=","; in_task=0; num=0
  }
  in_task { body = body $0 "\n"; bj="\"" escape_json(body) "\"" }
  END {
    if (in_task) {
      printf "%s{\"num\":%d,\"heading\":%s,\"body\":%s}", sep, num, hj, bj
    }
    printf "]"
  }
  function escape_json(s) {
    gsub(/\\/,"\\\\",s); gsub(/"/,"\\\"",s)
    gsub(/\n/,"\\n",s); gsub(/\r/,"",s); gsub(/\t/,"\\t",s)
    return s
  }
' "$PLAN")"

# --- per-task: extract slug + files (from body) ---
tasks_json="$(jq '
  map(. + {
    slug: (.heading | ascii_downcase | gsub("[^a-z0-9]+"; "-") | sub("^-+"; "") | sub("-+$"; "")),
    files: (
      .body
      | [scan("(?i)^[-*]\\s+(?:Create|Modify|Test):\\s+`?([^`\\s\\n]+)")]
      | map(.[0])
    ),
    test_command: (
      .body
      | capture("(?m)^Run:\\s+`?(?<c>[^`\\n]+)`?\\s*$"; "g")
      | .c? // null
    )
  })
' <<<"$tasks_json")"

# --- parse Parallelization section ---
waves_raw="$(awk '
  /^## Parallelization/ { in_sec=1; next }
  /^## / && in_sec { in_sec=0 }
  in_sec && /^- Wave [0-9]+:/ { print }
' "$PLAN")"

if [ -z "$waves_raw" ]; then
  # fallback: each task is its own wave in task-number order
  echo "WARNING: plan has no ## Parallelization section; running fully serial" >&2
  waves_json="$(jq '
    [ .[] | .num ]
    | sort
    | [ range(0; length) as $i | {wave:($i+1), tasks:[.[$i]]} ]
  ' <<<"$tasks_json")"
else
  waves_json="$(printf '%s\n' "$waves_raw" | awk '
    BEGIN { printf "["; sep="" }
    {
      match($0, /^- Wave ([0-9]+): *Tasks? (.*)$/, m)
      wave=m[1]+0; list=m[2]
      gsub(/[^0-9,]/, "", list)
      printf "%s{\"wave\":%d,\"tasks\":[%s]}", sep, wave, list
      sep=","
    }
    END { printf "]" }
  ')"
fi

# --- validation ---
validate() {
  # duplicate refs
  dup="$(jq -r '[.[] | .tasks[]] | group_by(.) | map(select(length>1) | .[0]) | .[]' <<<"$waves_json")"
  if [ -n "$dup" ]; then
    echo "ERROR: duplicate task references in Parallelization: $dup" >&2
    return 2
  fi
  # missing refs
  declared="$(jq -r '[.[] | .num] | sort | .[]' <<<"$tasks_json")"
  referenced="$(jq -r '[.[] | .tasks[]] | sort | .[]' <<<"$waves_json")"
  missing="$(comm -23 <(printf '%s\n' "$declared") <(printf '%s\n' "$referenced"))"
  if [ -n "$missing" ]; then
    echo "ERROR: tasks declared but not referenced in Parallelization: $missing" >&2
    return 2
  fi
  extra="$(comm -13 <(printf '%s\n' "$declared") <(printf '%s\n' "$referenced"))"
  if [ -n "$extra" ]; then
    echo "ERROR: Parallelization references unknown task numbers: $extra" >&2
    return 2
  fi
  # overlapping files within a wave
  overlap="$(jq -r --argjson tasks "$tasks_json" '
    .[] as $w
    | ($tasks | map(select(.num | IN($w.tasks[])) | {num, files})) as $wt
    | $wt
    | [range(0; length-1)] as $is
    | $is[] as $i
    | range($i+1; $wt|length) as $j
    | ($wt[$i].files | map(select(IN($wt[$j].files[])))) as $overlap
    | select($overlap | length > 0)
    | "wave=\($w.wave) task=\($wt[$i].num) task=\($wt[$j].num) files=\($overlap | join(","))"
  ' <<<"$waves_json")"
  if [ -n "$overlap" ]; then
    echo "ERROR: overlapping file claims within wave:" >&2
    printf '  %s\n' "$overlap" >&2
    return 2
  fi
  return 0
}

if ! validate; then exit 2; fi

# --- emit final JSON ---
jq -n \
  --arg goal "$goal" \
  --arg architecture "$architecture" \
  --arg test_command "$test_command" \
  --argjson tasks "$tasks_json" \
  --argjson waves "$waves_json" \
  '{goal:$goal, architecture:$architecture, test_command:$test_command, tasks:$tasks, waves:$waves}'
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-parse-plan
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-parse-plan.sh
```
Expected: PASS: test-parse-plan

- [ ] **Step 5: Verify full test suite**

```bash
.claude/skills/gstack/codex/tests/run-all.sh
```
Expected: `summary: 2/2 passed`

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-parse-plan \
        .claude/skills/gstack/codex/tests/
git commit -m "codex-implement: plan parser with wave DAG + validation"
```

---

### Task 3: State library (`codex-state`)

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-state`
- Create: `.claude/skills/gstack/codex/tests/test-state.sh`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-state.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
CS="$THIS_DIR/../bin/codex-state"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

STATE_DIR="$TMP/work"
mkdir -p "$STATE_DIR"

# init writes a minimal valid state.json
"$CS" init "$STATE_DIR" \
  --plan-path /tmp/plan.md --plan-sha abc123 \
  --base-ref origin/main --base-sha deadbeef \
  --waves '[{"wave":1,"tasks":[1,2]}]' \
  --tasks '[{"num":1,"slug":"a"},{"num":2,"slug":"b"}]'
test -r "$STATE_DIR/state.json"
jq -e '.plan_sha == "abc123"' "$STATE_DIR/state.json" > /dev/null
jq -e '.waves[0].tasks | length == 2' "$STATE_DIR/state.json" > /dev/null
jq -e '.waves[0].tasks[0].status == "pending"' "$STATE_DIR/state.json" > /dev/null

# set-status changes a task's status
"$CS" set-status "$STATE_DIR" --wave 1 --task 1 --status dispatched
jq -e '.waves[0].tasks[0].status == "dispatched"' "$STATE_DIR/state.json" > /dev/null

# append-attempt appends to attempt history
"$CS" append-attempt "$STATE_DIR" --wave 1 --task 1 \
  --impl codex-high --session-id s1 --result done
jq -e '.waves[0].tasks[0].attempts | length == 1' "$STATE_DIR/state.json" > /dev/null
jq -e '.waves[0].tasks[0].attempts[0].attempt == 1' "$STATE_DIR/state.json" > /dev/null

# get-status reads back
got="$("$CS" get-status "$STATE_DIR" --wave 1 --task 1)"
[ "$got" = "dispatched" ] || { echo "FAIL: get-status=$got"; exit 1; }

# concurrent writes don't corrupt (lightweight stress)
for i in 1 2 3 4 5; do
  "$CS" set-status "$STATE_DIR" --wave 1 --task 2 --status "dispatched" &
done
wait
jq . "$STATE_DIR/state.json" > /dev/null  # must still be valid JSON

echo "PASS: test-state"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-state.sh
.claude/skills/gstack/codex/tests/test-state.sh
```
Expected: FAIL — codex-state missing.

- [ ] **Step 2: Implement `codex-state`**

Create `.claude/skills/gstack/codex/bin/codex-state`:

```bash
#!/usr/bin/env bash
# State management for /codex implement.
# Commands:
#   init <state-dir> --plan-path P --plan-sha S --base-ref R --base-sha X
#                    --waves JSON --tasks JSON
#   set-status <state-dir> --wave W --task T --status S
#   get-status <state-dir> --wave W --task T
#   append-attempt <state-dir> --wave W --task T --impl I --session-id S --result R
#   set-wave-status <state-dir> --wave W --status S
#   set-task-commit <state-dir> --wave W --task T --sha X
#
# All writes are flock-guarded and atomic (tmpfile → rename).
set -euo pipefail

usage() {
  grep -E '^# ' "$0" | sed 's/^# //; s/^#$//'
  exit 2
}

STATE_DIR=""
cmd="${1:-}"; shift || usage
STATE_DIR="${1:-}"; shift || usage
[ -d "$STATE_DIR" ] || { mkdir -p "$STATE_DIR"; }

STATE_FILE="$STATE_DIR/state.json"
LOCK_FILE="$STATE_DIR/.state.lock"

# parse --key value pairs into an associative array ARGS
declare -A ARGS=()
while [ $# -gt 0 ]; do
  k="${1#--}"; v="${2:-}"
  ARGS["$k"]="$v"
  shift 2 || { echo "missing value for --$k" >&2; exit 2; }
done

arg() { printf '%s' "${ARGS[$1]:-}"; }

with_lock() {
  # BSD flock (macOS) requires shlock or we roll our own; prefer util-linux
  # style flock(1). Fall back to a PID-file mutex if unavailable.
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    flock 9
    "$@"
    flock -u 9
  else
    # simple PID-based spinlock, 5s timeout
    for _ in $(seq 1 50); do
      if (set -C; echo $$ > "$LOCK_FILE") 2>/dev/null; then
        trap 'rm -f "$LOCK_FILE"' EXIT
        "$@"
        rm -f "$LOCK_FILE"; trap - EXIT
        return 0
      fi
      sleep 0.1
    done
    echo "ERROR: could not acquire state lock" >&2; return 2
  fi
}

write_atomic() {
  # read JSON from stdin; rename tmpfile over STATE_FILE.
  local tmp; tmp="$(mktemp "$STATE_DIR/.state.XXXXXX")"
  cat > "$tmp"
  # sanity-check JSON before renaming
  if ! jq . "$tmp" > /dev/null 2>&1; then
    rm -f "$tmp"; echo "ERROR: refusing to write invalid JSON" >&2; return 2
  fi
  mv "$tmp" "$STATE_FILE"
}

stamp_updated() {
  date -u +%Y-%m-%dT%H:%M:%SZ
}

case "$cmd" in
  init)
    do_init() {
      if [ -r "$STATE_FILE" ]; then
        echo "ERROR: state already exists at $STATE_FILE" >&2; return 2
      fi
      tasks_by_num="$(jq 'map({(.num|tostring): .}) | add' <<<"$(arg tasks)")"
      jq -n \
        --arg plan_path "$(arg plan-path)" \
        --arg plan_sha  "$(arg plan-sha)" \
        --arg base_ref  "$(arg base-ref)" \
        --arg base_sha  "$(arg base-sha)" \
        --arg started   "$(stamp_updated)" \
        --argjson waves "$(arg waves)" \
        --argjson by_num "$tasks_by_num" \
        '{
          plan_path: $plan_path,
          plan_sha:  $plan_sha,
          base_ref:  $base_ref,
          base_sha_at_start: $base_sha,
          started_at: $started,
          last_updated_at: $started,
          waves: ($waves | map(
            . + {
              status: "pending",
              tasks: (.tasks | map(
                $by_num[(tostring)] as $t
                | {
                    num: $t.num, slug: $t.slug,
                    status: "pending", attempts: [],
                    worktree_path: null, branch: null,
                    final_commit_on_base: null
                  }
              ))
            }
          ))
        }' | write_atomic
    }
    with_lock do_init
    ;;

  set-status)
    do_set_status() {
      local w="$(arg wave)" t="$(arg task)" s="$(arg status)"
      jq --argjson w "$w" --argjson t "$t" --arg s "$s" \
         --arg now "$(stamp_updated)" '
        .last_updated_at = $now
        | (.waves[] | select(.wave == $w) | .tasks[] | select(.num == $t) | .status) = $s
      ' "$STATE_FILE" | write_atomic
    }
    with_lock do_set_status
    ;;

  get-status)
    local_get() {
      jq -r --argjson w "$(arg wave)" --argjson t "$(arg task)" \
        '.waves[] | select(.wave == $w) | .tasks[] | select(.num == $t) | .status' \
        "$STATE_FILE"
    }
    with_lock local_get
    ;;

  append-attempt)
    do_append() {
      local w="$(arg wave)" t="$(arg task)"
      local impl="$(arg impl)" sid="$(arg session-id)" res="$(arg result)"
      jq --argjson w "$w" --argjson t "$t" \
         --arg impl "$impl" --arg sid "$sid" --arg res "$res" \
         --arg now "$(stamp_updated)" '
        .last_updated_at = $now
        | (.waves[] | select(.wave == $w) | .tasks[] | select(.num == $t) | .attempts) as $a
        | (.waves[] | select(.wave == $w) | .tasks[] | select(.num == $t) | .attempts) |=
            (. + [{attempt: (($a | length) + 1), impl: $impl, session_id: $sid, result: $res}])
      ' "$STATE_FILE" | write_atomic
    }
    with_lock do_append
    ;;

  set-wave-status)
    do_ws() {
      local w="$(arg wave)" s="$(arg status)"
      jq --argjson w "$w" --arg s "$s" --arg now "$(stamp_updated)" '
        .last_updated_at = $now
        | (.waves[] | select(.wave == $w) | .status) = $s
      ' "$STATE_FILE" | write_atomic
    }
    with_lock do_ws
    ;;

  set-task-commit)
    do_sc() {
      local w="$(arg wave)" t="$(arg task)" sha="$(arg sha)"
      jq --argjson w "$w" --argjson t "$t" --arg sha "$sha" \
         --arg now "$(stamp_updated)" '
        .last_updated_at = $now
        | (.waves[] | select(.wave == $w) | .tasks[] | select(.num == $t) | .final_commit_on_base) = $sha
      ' "$STATE_FILE" | write_atomic
    }
    with_lock do_sc
    ;;

  *)
    usage
    ;;
esac
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-state
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-state.sh
```
Expected: PASS: test-state

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-state \
        .claude/skills/gstack/codex/tests/test-state.sh
git commit -m "codex-implement: state library with flock + atomic writes"
```

---

### Task 4: Worktree lifecycle helpers (`codex-worktree`)

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-worktree`
- Create: `.claude/skills/gstack/codex/tests/test-worktree.sh`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-worktree.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
WT="$THIS_DIR/../bin/codex-worktree"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# set up a bare-style throwaway repo
cd "$TMP"
git init -q repo && cd repo
git config user.email "t@t.t"; git config user.name "t"
echo a > a.txt
git add a.txt && git commit -qm init
git checkout -qb testbase

# setup a worktree for task 1
"$WT" setup "$TMP/work/myplan" task-alpha testbase
test -d "$TMP/work/myplan/task-alpha" || { echo "FAIL: no worktree dir"; exit 1; }
cd "$TMP/work/myplan/task-alpha"
branch="$(git branch --show-current)"
[ "$branch" = "codex/myplan/task-alpha" ] || { echo "FAIL: wrong branch=$branch"; exit 1; }

# commit something in the worktree
echo b > b.txt
git add b.txt && git commit -qm "add b"

# teardown
cd "$TMP/repo"
"$WT" teardown "$TMP/work/myplan" task-alpha
test ! -d "$TMP/work/myplan/task-alpha" || { echo "FAIL: worktree remains"; exit 1; }
# branch also deleted
git rev-parse --verify codex/myplan/task-alpha 2>/dev/null && { echo "FAIL: branch remains"; exit 1; } || true

echo "PASS: test-worktree"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-worktree.sh
.claude/skills/gstack/codex/tests/test-worktree.sh
```
Expected: FAIL — codex-worktree missing.

- [ ] **Step 2: Implement `codex-worktree`**

Create `.claude/skills/gstack/codex/bin/codex-worktree`:

```bash
#!/usr/bin/env bash
# Worktree lifecycle helpers for /codex implement.
# Commands:
#   setup    <plan-work-dir> <task-slug> <base-ref>
#   teardown <plan-work-dir> <task-slug>
#   list     <plan-work-dir>
set -euo pipefail

cmd="${1:-}"; shift || { echo "usage: codex-worktree <cmd> ..." >&2; exit 2; }

case "$cmd" in
  setup)
    work_dir="${1:?}" slug="${2:?}" base="${3:?}"
    dest="$work_dir/$slug"
    branch="codex/$(basename "$work_dir")/$slug"
    mkdir -p "$work_dir"
    if [ -e "$dest" ]; then
      echo "ERROR: $dest already exists — use teardown first" >&2; exit 2
    fi
    # Repo root we're managing worktrees on must be the current repo root
    repo_root="$(git rev-parse --show-toplevel)"
    cd "$repo_root"
    git worktree add -b "$branch" "$dest" "$base" >&2
    echo "$dest"
    ;;

  teardown)
    work_dir="${1:?}" slug="${2:?}"
    dest="$work_dir/$slug"
    branch="codex/$(basename "$work_dir")/$slug"
    repo_root="$(git rev-parse --show-toplevel)"
    cd "$repo_root"
    if [ -d "$dest" ]; then
      git worktree remove --force "$dest" >&2 || true
    fi
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      git branch -D "$branch" >&2 || true
    fi
    # also nuke the directory in case git worktree remove left artifacts
    rm -rf "$dest"
    ;;

  list)
    work_dir="${1:?}"
    ls -1 "$work_dir" 2>/dev/null | grep -v '^state\.json$' | grep -v '^\.' || true
    ;;

  *)
    echo "usage: codex-worktree setup|teardown|list ..." >&2; exit 2
    ;;
esac
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-worktree
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-worktree.sh
```
Expected: PASS: test-worktree

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-worktree \
        .claude/skills/gstack/codex/tests/test-worktree.sh
git commit -m "codex-implement: worktree setup/teardown helpers"
```

---

### Task 5: Single-task Codex dispatch + Stage 1 test gate (`codex-dispatch-task`)

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-dispatch-task`
- Create: `.claude/skills/gstack/codex/codex-implementer-prompt.md`
- Create: `.claude/skills/gstack/codex/tests/test-dispatch-task.sh`

- [ ] **Step 1: Write the prompt template**

Create `.claude/skills/gstack/codex/codex-implementer-prompt.md`:

```
You are implementing ONE task from an approved implementation plan.

PLAN GOAL: {{GOAL}}
PLAN ARCHITECTURE: {{ARCHITECTURE}}

YOUR TASK: {{TASK_HEADING}}

TASK INSTRUCTIONS (complete steps in order):
{{TASK_BODY}}

{{PRIOR_ATTEMPT_FINDINGS}}

CONSTRAINTS:
- Work only within the current git worktree at {{WORKTREE_PATH}}.
- Do NOT edit these files (they belong to parallel tasks): {{FORBIDDEN_FILES}}.
- Follow TDD: write the failing test first, then the minimal implementation.
- Commit with descriptive messages after each logical step.
- On completion, run: {{TEST_COMMAND}}
- Your final message MUST include exactly one status code on its own line:
  DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
  (These match superpowers:subagent-driven-development status codes.)

FILESYSTEM BOUNDARY:
Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/,
or agents/. These are AI skill definitions for a different system. Do NOT
modify agents/openai.yaml. Stay focused on repository source code.
```

- [ ] **Step 2: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-dispatch-task.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
DISPATCH="$THIS_DIR/../bin/codex-dispatch-task"
FAKE="$THIS_DIR/codex-fake"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# a minimal worktree (just a directory; the dispatcher doesn't validate)
WT="$TMP/wt"; mkdir -p "$WT"
LOGDIR="$TMP/logs"; mkdir -p "$LOGDIR"

# scripted success response
cat > "$TMP/responses.jsonl" <<'EOF'
{"type":"message","text":"working..."}
{"type":"final","text":"all good\nDONE"}
EOF
echo "exit 0" > "$TMP/exit"

# dispatch, using fake codex
CODEX_BIN="$FAKE" \
CODEX_FAKE_RESPONSES="$TMP/responses.jsonl" \
CODEX_FAKE_EXIT_FILE="$TMP/exit" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/alpha.log" \
    --prompt-file <(echo "minimal prompt") \
    --reasoning high \
    --session-file "$TMP/alpha.sid" \
  > "$TMP/dispatch.out"

status="$(cat "$TMP/dispatch.out")"
[ "$status" = "DONE" ] || { echo "FAIL: status=$status"; exit 1; }
test -r "$LOGDIR/alpha.log" || { echo "FAIL: log not written"; exit 1; }

# scripted BLOCKED response
cat > "$TMP/responses.jsonl" <<'EOF'
{"type":"final","text":"can't proceed\nBLOCKED"}
EOF
echo "exit 0" > "$TMP/exit"

CODEX_BIN="$FAKE" \
CODEX_FAKE_RESPONSES="$TMP/responses.jsonl" \
CODEX_FAKE_EXIT_FILE="$TMP/exit" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/beta.log" \
    --prompt-file <(echo "p") \
    --reasoning high \
    --session-file "$TMP/beta.sid" \
  > "$TMP/out"

[ "$(cat "$TMP/out")" = "BLOCKED" ] || { echo "FAIL"; exit 1; }

echo "PASS: test-dispatch-task"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-dispatch-task.sh
.claude/skills/gstack/codex/tests/test-dispatch-task.sh
```
Expected: FAIL — codex-dispatch-task missing.

- [ ] **Step 3: Implement `codex-dispatch-task`**

Create `.claude/skills/gstack/codex/bin/codex-dispatch-task`:

```bash
#!/usr/bin/env bash
# Run a single Codex attempt. Stream JSONL to log file. Parse the final status
# code from the last message. Print just the status code (DONE/BLOCKED/etc) on stdout.
#
# Options:
#   --worktree <dir>        working root for codex
#   --log <file>            JSONL output log
#   --prompt-file <file>    rendered prompt (plain text)
#   --reasoning <lvl>       low|medium|high|xhigh
#   --session-file <file>   path; if exists, we resume the session id written
#                           there; in any case we write the new session id
#                           (or a synthesized one if codex didn't expose it).
#   --timeout <sec>         optional, default 1800
set -euo pipefail

CODEX="${CODEX_BIN:-codex}"

WT=""; LOG=""; PROMPT_FILE=""; REASONING="high"; SID_FILE=""; TO=1800
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree)     WT="$2"; shift 2 ;;
    --log)          LOG="$2"; shift 2 ;;
    --prompt-file)  PROMPT_FILE="$2"; shift 2 ;;
    --reasoning)    REASONING="$2"; shift 2 ;;
    --session-file) SID_FILE="$2"; shift 2 ;;
    --timeout)      TO="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
: "${WT:?--worktree required}"
: "${LOG:?--log required}"
: "${PROMPT_FILE:?--prompt-file required}"
: "${SID_FILE:?--session-file required}"

prompt="$(cat "$PROMPT_FILE")"

mkdir -p "$(dirname "$LOG")"

# Build argv
args=(exec
  -s workspace-write
  -C "$WT"
  -c "model_reasoning_effort=\"$REASONING\""
  --enable web_search_cached
  --json)

if [ -s "$SID_FILE" ]; then
  args=(exec resume "$(cat "$SID_FILE")"
    -C "$WT"
    -c "model_reasoning_effort=\"$REASONING\""
    --enable web_search_cached
    --json)
fi

# run with a timeout; tee into log
if command -v timeout >/dev/null 2>&1; then
  TO_CMD=(timeout "$TO")
elif command -v gtimeout >/dev/null 2>&1; then
  TO_CMD=(gtimeout "$TO")
else
  TO_CMD=()
fi

tmp_out="$(mktemp)"
trap 'rm -f "$tmp_out"' EXIT

set +e
"${TO_CMD[@]}" "$CODEX" "${args[@]}" "$prompt" > "$tmp_out" 2>&1
rc=$?
set -e

cat "$tmp_out" >> "$LOG"

# capture session id if the codex output reveals one (look for a field named "session_id")
jq -r 'select(.session_id != null) | .session_id' "$tmp_out" 2>/dev/null | tail -n1 > "$SID_FILE.new" || true
if [ -s "$SID_FILE.new" ]; then mv "$SID_FILE.new" "$SID_FILE"; else rm -f "$SID_FILE.new"; fi

# detect status from the last message/text seen
final_text="$(jq -r 'select(.text != null) | .text' "$tmp_out" 2>/dev/null | tail -n1)"
if [ -z "$final_text" ]; then
  # try raw stdout (non-JSONL fake)
  final_text="$(tail -n 5 "$tmp_out")"
fi

case "$final_text" in
  *DONE_WITH_CONCERNS*) echo "DONE_WITH_CONCERNS" ;;
  *DONE*)                echo "DONE" ;;
  *NEEDS_CONTEXT*)       echo "NEEDS_CONTEXT" ;;
  *BLOCKED*)             echo "BLOCKED" ;;
  *)
    if [ "$rc" -eq 124 ]; then
      echo "BLOCKED"    # timeout
    elif [ "$rc" -ne 0 ]; then
      echo "BLOCKED"    # non-zero exit, no status code
    else
      echo "DONE_WITH_CONCERNS"  # clean exit but no status code found
    fi
    ;;
esac

exit 0
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-dispatch-task
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-dispatch-task.sh
```
Expected: PASS: test-dispatch-task

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-dispatch-task \
        .claude/skills/gstack/codex/codex-implementer-prompt.md \
        .claude/skills/gstack/codex/tests/test-dispatch-task.sh
git commit -m "codex-implement: single-task Codex dispatcher + prompt template"
```

---

### Task 6: Stage 2 `codex review` gate wrapper

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-gate-review`
- Create: `.claude/skills/gstack/codex/tests/test-gate-review.sh`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-gate-review.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$THIS_DIR/../bin/codex-gate-review"
FAKE="$THIS_DIR/codex-fake"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Case 1: review passes (no blocking issues)
cat > "$TMP/r.jsonl" <<'EOF'
{"type":"final","text":"Review complete. No blocking issues found.\nOK"}
EOF
echo "exit 0" > "$TMP/e"
CODEX_BIN="$FAKE" CODEX_FAKE_RESPONSES="$TMP/r.jsonl" CODEX_FAKE_EXIT_FILE="$TMP/e" \
  "$GATE" --worktree "$TMP" --base origin/main --findings-file "$TMP/findings.txt" \
  > "$TMP/out"
[ "$(cat "$TMP/out")" = "PASS" ] || { echo "FAIL case 1: $(cat $TMP/out)"; exit 1; }

# Case 2: review fails (P1 issue)
cat > "$TMP/r.jsonl" <<'EOF'
{"type":"final","text":"[P1] race condition in foo.ts:42\nFAIL"}
EOF
CODEX_BIN="$FAKE" CODEX_FAKE_RESPONSES="$TMP/r.jsonl" CODEX_FAKE_EXIT_FILE="$TMP/e" \
  "$GATE" --worktree "$TMP" --base origin/main --findings-file "$TMP/findings.txt" \
  > "$TMP/out"
[ "$(cat "$TMP/out")" = "FAIL" ] || { echo "FAIL case 2"; exit 1; }
grep -q "P1" "$TMP/findings.txt" || { echo "FAIL: findings not written"; exit 1; }

echo "PASS: test-gate-review"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-gate-review.sh
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
.claude/skills/gstack/codex/tests/test-gate-review.sh
```
Expected: FAIL — codex-gate-review missing.

- [ ] **Step 3: Implement `codex-gate-review`**

Create `.claude/skills/gstack/codex/bin/codex-gate-review`:

```bash
#!/usr/bin/env bash
# Stage 2 gate: run `codex review --base <base>` in a worktree, emit PASS or FAIL.
# On FAIL, write the verbatim review output to --findings-file.
set -euo pipefail

CODEX="${CODEX_BIN:-codex}"
WT=""; BASE=""; FINDINGS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree)       WT="$2"; shift 2 ;;
    --base)           BASE="$2"; shift 2 ;;
    --findings-file)  FINDINGS="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
: "${WT:?}" "${BASE:?}" "${FINDINGS:?}"

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT

# The existing /codex skill runs:
#   codex review "..." --base <base> -c 'model_reasoning_effort="high"' --enable web_search_cached
# We invoke the same CLI directly here (we don't want the full skill preamble).
(cd "$WT" && "$CODEX" review \
  "IMPORTANT: Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/. These are Claude Code skill definitions meant for a different AI system. Do NOT modify agents/openai.yaml. Stay focused on repository code only." \
  --base "$BASE" \
  -c 'model_reasoning_effort="high"' \
  --enable web_search_cached) > "$tmp" 2>&1

# Simple pass/fail heuristic: look for tokens commonly emitted by `codex review`.
# `codex review` prints structured findings; we treat the appearance of
# [P0]/[P1] severity markers, or the literal word FAIL on its own line, as failure.
if grep -Eq '^\[(P0|P1|CRITICAL|MAJOR)\]|^FAIL$|^[[:space:]]*blocking issue' "$tmp"; then
  cp "$tmp" "$FINDINGS"
  echo "FAIL"
  exit 0
fi

echo "PASS"
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-gate-review
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-gate-review.sh
```
Expected: PASS: test-gate-review

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-gate-review \
        .claude/skills/gstack/codex/tests/test-gate-review.sh
git commit -m "codex-implement: stage-2 codex review gate wrapper"
```

---

### Task 7: Claude spec-check + fallback prompt templates + marker protocol docs

**Files:**
- Create: `.claude/skills/gstack/codex/spec-reviewer-prompt.md`
- Create: `.claude/skills/gstack/codex/codex-fallback-prompt.md`
- Create: `.claude/skills/gstack/codex/PROTOCOL.md`

- [ ] **Step 1: Write `spec-reviewer-prompt.md`**

Create `.claude/skills/gstack/codex/spec-reviewer-prompt.md`:

```
You are performing spec-compliance review on code changes produced by OpenAI Codex
for a single task inside an approved implementation plan. You did NOT implement the
change; your job is to independently verify it fulfils the spec.

PLAN GOAL: {{GOAL}}
PLAN ARCHITECTURE: {{ARCHITECTURE}}

TASK SPEC (what Codex was instructed to do):
{{TASK_BODY}}

DIFF (git diff {{BASE}}...HEAD, applied in the task worktree):
```
{{DIFF}}
```

Your job:
1. Read the task spec carefully. Identify the concrete changes it required
   (files touched, functions added, tests added, commands to run).
2. Check the diff against each requirement. Note anything missing, incorrect,
   or over-scoped.
3. Do NOT judge code style or elegance. That is handled separately.
4. Do NOT propose refactors beyond the spec.

Reply with EXACTLY this structure:

VERDICT: PASS
(or)
VERDICT: FAIL

THEN a short bullet list of reasons. If PASS, list "all spec requirements met"
as a single confirmation. If FAIL, list each missing or violated requirement
concretely enough that the implementer can fix it.

Finish your reply with exactly one line containing only the word PASS or FAIL
(so the orchestrator can grep it).
```

- [ ] **Step 2: Write `codex-fallback-prompt.md`**

Create `.claude/skills/gstack/codex/codex-fallback-prompt.md`:

```
You are taking over from OpenAI Codex as the implementer for ONE task in an
approved plan. Codex attempted this task 3 times and still failed the merge
gate. The code Codex produced is committed in the current worktree —
preserve useful progress, don't throw it all away unless the findings below
indicate Codex headed in the wrong direction.

PLAN GOAL: {{GOAL}}
PLAN ARCHITECTURE: {{ARCHITECTURE}}

TASK SPEC (what needs to be done):
{{TASK_BODY}}

CODEX ATTEMPT HISTORY:
{{ATTEMPT_SUMMARIES}}

CURRENT WORKTREE: {{WORKTREE_PATH}} (branch: {{BRANCH}})

Instructions:
1. Inspect what Codex committed so far (`git log --oneline {{BASE}}..HEAD`).
2. Read the findings from the last failed gate attempt carefully.
3. Make targeted fixes or, if the approach is wrong, revert and restart.
4. Follow TDD: tests first. Commit frequently.
5. Do NOT edit files outside this worktree.
6. Do NOT touch: {{FORBIDDEN_FILES}} (parallel tasks own them).
7. When done, run: {{TEST_COMMAND}}
8. Report DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED as your final line.

Use `superpowers:subagent-driven-development` discipline: commits have clear
messages, tests are hermetic, no fake-it-til-you-make-it mocks for the thing
the task actually required.
```

- [ ] **Step 3: Write `PROTOCOL.md` describing the marker-file protocol**

Create `.claude/skills/gstack/codex/PROTOCOL.md`:

```markdown
# /codex implement — Bash ↔ Claude Marker Protocol

The orchestrator is a two-layer workflow. Bash helpers do plumbing; Claude
(the coordinating session) handles Stage 3 spec checks and attempt-4 Claude
fallbacks. The two layers synchronize through marker files in the plan's
work directory.

## Marker files

**`needs-spec-check.<wave>.<task-num>.json`** — bash writes when a task
reaches Stage 3. Schema:

```json
{
  "wave": 1,
  "task": 3,
  "task_body": "...",           // verbatim task body from plan
  "plan_goal": "...",
  "plan_architecture": "...",
  "base": "origin/main",
  "worktree_path": "...",
  "diff_file": ".../diff.txt",
  "requested_at": "2026-04-15T..."
}
```

Claude reads the marker, renders `spec-reviewer-prompt.md` with it, dispatches
a Task() subagent, writes the result to:

**`spec-check-result.<wave>.<task-num>.json`**:

```json
{
  "verdict": "PASS" | "FAIL",
  "findings_text": "...",       // full subagent response
  "completed_at": "..."
}
```

Then Claude deletes the `needs-spec-check.*.json` file.

**`needs-claude-fallback.<wave>.<task-num>.json`** — bash writes when attempts
1-3 fail. Claude reads, dispatches a Claude Task() subagent using
`codex-fallback-prompt.md`, waits for completion, writes:

**`claude-fallback-result.<wave>.<task-num>.json`**:

```json
{
  "status": "DONE" | "DONE_WITH_CONCERNS" | "NEEDS_CONTEXT" | "BLOCKED",
  "summary": "...",
  "completed_at": "..."
}
```

## Orchestrator loop (from Claude's side)

After invoking each bash helper phase, Claude runs:

```
for f in <work-dir>/needs-spec-check.*.json; do
  dispatch Task() spec-reviewer with payload from f
  write result file
  rm f
done
for f in <work-dir>/needs-claude-fallback.*.json; do
  dispatch Task() implementer with payload from f
  write result file
  rm f
done
```

Bash helpers poll for the corresponding `*-result.json` files and proceed.
Bash uses a bounded poll: up to 15 minutes (configurable), then raises a
`BLOCKED` with reason `claude-not-responding`.

## Why this split

- Bash is perfect at flock, subprocess fan-out, codex CLI invocation, git.
- Claude Task() can only be dispatched from Claude's session.
- Marker files make the boundary explicit and crash-safe — if anything dies
  mid-run, the surviving layer sees the exact state in files on disk.
```

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gstack/codex/spec-reviewer-prompt.md \
        .claude/skills/gstack/codex/codex-fallback-prompt.md \
        .claude/skills/gstack/codex/PROTOCOL.md
git commit -m "codex-implement: prompt templates + marker-file protocol doc"
```

---

### Task 8: Retry ladder + gate loop (`codex-gate`)

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-gate`
- Create: `.claude/skills/gstack/codex/tests/test-gate.sh`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-gate.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
GATE="$THIS_DIR/../bin/codex-gate"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Build a toy "worktree": pretend it's a git repo with a trivial test cmd
WT="$TMP/wt"; mkdir -p "$WT"
(cd "$WT" && git init -q && git config user.email t@t.t && git config user.name t
 echo ok > marker.txt && git add marker.txt && git commit -qm init)

STATE="$TMP/state"; mkdir -p "$STATE"

# Happy path: Stage 1 passes, Stage 2 passes, Stage 3 passes on attempt 1.
# Simulate by using `true` as the task test command and configuring
# a fake codex-gate-review that always PASSES.
export CODEX_BIN="$THIS_DIR/codex-fake"
cat > "$TMP/fakes/codex-gate-review" <<'EOF'
#!/usr/bin/env bash
# a fake stage-2 that always passes
echo PASS
EOF
mkdir -p "$TMP/fakes"
# (real file lives at bin/codex-gate-review; we stub by PATH shadowing)
cat > "$TMP/fakes/codex-gate-review" <<'EOF'
#!/usr/bin/env bash
echo PASS
EOF
chmod +x "$TMP/fakes/codex-gate-review"
export PATH="$TMP/fakes:$PATH"

# write a dummy "needs-spec-check → spec-check-result" responder simulating Claude
WORK="$TMP/work"; mkdir -p "$WORK"

# pre-write a spec-check-result file so the gate doesn't have to wait for Claude
# (we'll exercise the polling path in Task 11's integration test)
cat > "$WORK/spec-check-result.1.1.json" <<'EOF'
{"verdict":"PASS","findings_text":"all spec requirements met","completed_at":"now"}
EOF

"$GATE" \
  --worktree "$WT" \
  --work-dir "$WORK" \
  --wave 1 --task 1 --task-slug alpha \
  --base main \
  --test-cmd "true" \
  --spec-check-poll-seconds 2 \
  > "$TMP/out"

grep -q '^PASS$' "$TMP/out" || { echo "FAIL: expected PASS"; cat "$TMP/out"; exit 1; }

echo "PASS: test-gate (happy-path only; retry paths exercised in e2e)"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-gate.sh
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
.claude/skills/gstack/codex/tests/test-gate.sh
```
Expected: FAIL — codex-gate missing.

- [ ] **Step 3: Implement `codex-gate`**

Create `.claude/skills/gstack/codex/bin/codex-gate`:

```bash
#!/usr/bin/env bash
# Runs the 3-stage merge gate on a single task worktree. On gate failure,
# assembles findings and returns them so the caller can re-dispatch Codex.
#
# Input flags:
#   --worktree <dir>            task worktree
#   --work-dir  <dir>           plan work dir (home of state.json + markers)
#   --wave <N> --task <N> --task-slug <slug>
#   --base <ref>                base branch ref
#   --test-cmd <string>         the plan's/task's test command (run inside worktree)
#   --spec-check-poll-seconds <sec>  how often to poll the marker file (default 5)
#   --spec-check-timeout-seconds <sec>  total wait (default 900)
#
# Output on stdout (single line):
#   PASS
#   or
#   FAIL <stage>    # stage = tests|review|spec
#
# Side effects on FAIL:
#   writes findings to $WORK/findings.<wave>.<task>.<attempt>.txt
set -euo pipefail

WT="" WORK="" WAVE="" TASK="" SLUG="" BASE=""
TEST_CMD=""
POLL=5 TIMEOUT=900
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree)                   WT="$2"; shift 2 ;;
    --work-dir)                   WORK="$2"; shift 2 ;;
    --wave)                       WAVE="$2"; shift 2 ;;
    --task)                       TASK="$2"; shift 2 ;;
    --task-slug)                  SLUG="$2"; shift 2 ;;
    --base)                       BASE="$2"; shift 2 ;;
    --test-cmd)                   TEST_CMD="$2"; shift 2 ;;
    --spec-check-poll-seconds)    POLL="$2"; shift 2 ;;
    --spec-check-timeout-seconds) TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
: "${WT:?}" "${WORK:?}" "${WAVE:?}" "${TASK:?}" "${SLUG:?}" "${BASE:?}" "${TEST_CMD:?}"

MARKER_IN="$WORK/needs-spec-check.$WAVE.$TASK.json"
MARKER_OUT="$WORK/spec-check-result.$WAVE.$TASK.json"

findings_file() {
  local attempt="$1"
  printf '%s/findings.%s.%s.%s.txt\n' "$WORK" "$WAVE" "$TASK" "$attempt"
}

# -------- Stage 1: task-local tests --------
stage_tests() {
  local attempt="$1" ff; ff="$(findings_file "$attempt")"
  local tmp; tmp="$(mktemp)"
  if (cd "$WT" && bash -c "$TEST_CMD") > "$tmp" 2>&1; then
    rm -f "$tmp"; return 0
  fi
  {
    echo "=== STAGE 1: TASK-LOCAL TESTS FAILED ==="
    echo "command: $TEST_CMD"
    echo "--- last 100 lines ---"
    tail -n 100 "$tmp"
  } > "$ff"
  rm -f "$tmp"
  return 1
}

# -------- Stage 2: codex review --------
SIBLING_BIN="$(cd "$(dirname "$0")" && pwd)"

stage_review() {
  local attempt="$1" ff; ff="$(findings_file "$attempt")"
  local rv
  rv="$("$SIBLING_BIN/codex-gate-review" --worktree "$WT" --base "$BASE" --findings-file "$ff.review" 2>/dev/null)"
  if [ "$rv" = "PASS" ]; then
    rm -f "$ff.review"; return 0
  fi
  {
    echo "=== STAGE 2: CODEX REVIEW FAILED ==="
    cat "$ff.review"
  } > "$ff"
  rm -f "$ff.review"
  return 1
}

# -------- Stage 3: Claude spec check (via marker protocol) --------
stage_spec() {
  local attempt="$1" ff; ff="$(findings_file "$attempt")"
  # Assemble diff + write request marker
  local diff_file="$WORK/diff.$WAVE.$TASK.txt"
  (cd "$WT" && git diff "$BASE"...HEAD) > "$diff_file"

  # write marker
  jq -n \
    --argjson w "$WAVE" --argjson t "$TASK" \
    --arg base "$BASE" --arg wt "$WT" \
    --arg diff "$diff_file" --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{wave:$w, task:$t, base:$base, worktree_path:$wt, diff_file:$diff, requested_at:$now}' \
    > "$MARKER_IN.tmp"
  mv "$MARKER_IN.tmp" "$MARKER_IN"

  # poll for result
  local waited=0
  while [ ! -r "$MARKER_OUT" ]; do
    sleep "$POLL"; waited=$((waited + POLL))
    if [ "$waited" -ge "$TIMEOUT" ]; then
      {
        echo "=== STAGE 3: TIMED OUT waiting for Claude spec check ==="
        echo "marker file still present: $MARKER_IN"
      } > "$ff"
      return 1
    fi
  done

  local verdict
  verdict="$(jq -r '.verdict' "$MARKER_OUT")"
  if [ "$verdict" = "PASS" ]; then
    rm -f "$MARKER_OUT"; return 0
  fi
  {
    echo "=== STAGE 3: CLAUDE SPEC CHECK FAILED ==="
    jq -r '.findings_text' "$MARKER_OUT"
  } > "$ff"
  rm -f "$MARKER_OUT"
  return 1
}

# Default attempt = 1 unless caller sets $GATE_ATTEMPT.
attempt="${GATE_ATTEMPT:-1}"

if ! stage_tests "$attempt"; then echo "FAIL tests"; exit 0; fi
if ! stage_review "$attempt"; then echo "FAIL review"; exit 0; fi
if ! stage_spec   "$attempt"; then echo "FAIL spec"; exit 0; fi

echo "PASS"
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-gate
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-gate.sh
```
Expected: PASS: test-gate

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-gate \
        .claude/skills/gstack/codex/tests/test-gate.sh
git commit -m "codex-implement: 3-stage merge gate with Claude marker polling"
```

---

### Task 9: Wave runner (`codex-run-wave`)

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-run-wave`

- [ ] **Step 1: Implement `codex-run-wave`**

(This task's logic is complex and exercised end-to-end in Task 14 rather than with a dedicated unit test.)

Create `.claude/skills/gstack/codex/bin/codex-run-wave`:

```bash
#!/usr/bin/env bash
# Run ONE wave of tasks:
#   1. for each task in the wave, set up worktree and dispatch codex (up to max-parallel)
#   2. wait for all dispatch to return their status
#   3. run the 3-stage gate per task; on gate failure, re-dispatch (retry ladder)
#   4. tasks that pass → leave the worktree + branch in place for the merger
#   5. tasks that exhaust retries → emit needs-claude-fallback marker;
#      wait for claude-fallback-result; if still bad, state=escalated and stop wave
#
# Env / flags:
#   --work-dir <dir>     plan work dir
#   --wave <N>           wave number
#   --base <ref>
#   --plan-json <file>   output of codex-parse-plan
#   --max-parallel <N>   default 4
#   --task-timeout <sec> default 1800
#
# Exits 0 if every task in the wave ends up "passed gate".
# Exits 2 if any task ended up "escalated" (caller stops the run).
set -euo pipefail

WORK="" WAVE="" BASE="" PLAN_JSON="" MAX_PARALLEL=4 TIMEOUT=1800
while [ $# -gt 0 ]; do
  case "$1" in
    --work-dir)      WORK="$2"; shift 2 ;;
    --wave)          WAVE="$2"; shift 2 ;;
    --base)          BASE="$2"; shift 2 ;;
    --plan-json)     PLAN_JSON="$2"; shift 2 ;;
    --max-parallel)  MAX_PARALLEL="$2"; shift 2 ;;
    --task-timeout)  TIMEOUT="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
: "${WORK:?}" "${WAVE:?}" "${BASE:?}" "${PLAN_JSON:?}"

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$SKILL_DIR/bin"
PROMPT_TMPL="$SKILL_DIR/codex-implementer-prompt.md"

# tasks in this wave
wave_tasks="$(jq --argjson w "$WAVE" \
  '.waves[] | select(.wave == $w) | .tasks[]' "$PLAN_JSON")"

task_meta() {  # $1 = task num; emits json
  jq --argjson n "$1" '.tasks[] | select(.num == $n)' "$PLAN_JSON"
}

render_prompt() {
  local num="$1" findings="${2:-}" forbidden="$3"
  local meta; meta="$(task_meta "$num")"
  local heading body test_cmd
  heading="$(jq -r '.heading' <<<"$meta")"
  body="$(jq -r '.body' <<<"$meta")"
  test_cmd="$(jq -r '.test_command // empty' <<<"$meta")"
  [ -z "$test_cmd" ] && test_cmd="$(jq -r '.test_command' "$PLAN_JSON")"
  local goal arch
  goal="$(jq -r '.goal' "$PLAN_JSON")"
  arch="$(jq -r '.architecture' "$PLAN_JSON")"

  local prior_section=""
  if [ -n "$findings" ] && [ -r "$findings" ]; then
    prior_section="PRIOR ATTEMPT FAILED BECAUSE:
$(cat "$findings")

Fix and re-verify."
  fi

  awk -v goal="$goal" -v arch="$arch" -v heading="$heading" \
      -v body="$body" -v prior="$prior_section" \
      -v wt="$WORK/$(jq -r '.slug' <<<"$meta")" \
      -v fb="$forbidden" -v tc="$test_cmd" '
    {
      gsub(/\{\{GOAL\}\}/, goal)
      gsub(/\{\{ARCHITECTURE\}\}/, arch)
      gsub(/\{\{TASK_HEADING\}\}/, heading)
      gsub(/\{\{TASK_BODY\}\}/, body)
      gsub(/\{\{PRIOR_ATTEMPT_FINDINGS\}\}/, prior)
      gsub(/\{\{WORKTREE_PATH\}\}/, wt)
      gsub(/\{\{FORBIDDEN_FILES\}\}/, fb)
      gsub(/\{\{TEST_COMMAND\}\}/, tc)
      print
    }
  ' "$PROMPT_TMPL"
}

# Build a map of each task's forbidden files (all files claimed by every OTHER task in the wave).
declare -A FORBIDDEN=()
for n in $wave_tasks; do
  own="$(jq -r --argjson n "$n" '.tasks[] | select(.num == $n) | .files | join(",")' "$PLAN_JSON")"
  others="$(jq -r --argjson n "$n" --argjson w "$WAVE" '
    [.waves[] | select(.wave == $w) | .tasks[] | select(. != $n)] as $peers
    | .tasks[] | select(.num | IN($peers[])) | .files[]' "$PLAN_JSON" | sort -u | paste -sd, -)"
  FORBIDDEN["$n"]="$others"
done

# Dispatch + gate loop per task, up to MAX_PARALLEL concurrent tasks.
LOGS="$WORK/logs"; mkdir -p "$LOGS"
PIDS="$WORK/pids"; mkdir -p "$PIDS"

process_one() {
  local num="$1"
  local slug; slug="$(task_meta "$num" | jq -r '.slug')"
  local wt="$WORK/$slug"
  local sid_file="$WORK/sid.$WAVE.$num"
  local prompt_file="$WORK/prompt.$WAVE.$num.txt"
  local attempt=1 findings=""
  local reasoning="high"
  local test_cmd
  test_cmd="$(task_meta "$num" | jq -r '.test_command // empty')"
  [ -z "$test_cmd" ] && test_cmd="$(jq -r '.test_command' "$PLAN_JSON")"

  "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$num" --status dispatched

  # set up the worktree (if not already present)
  if [ ! -d "$wt" ]; then
    "$BIN/codex-worktree" setup "$WORK" "$slug" "$BASE" > /dev/null
  fi

  while :; do
    # render prompt (with findings if this is a retry)
    render_prompt "$num" "$findings" "${FORBIDDEN[$num]}" > "$prompt_file"

    local status
    status="$("$BIN/codex-dispatch-task" \
      --worktree "$wt" \
      --log "$LOGS/$slug.log" \
      --prompt-file "$prompt_file" \
      --reasoning "$reasoning" \
      --session-file "$sid_file" \
      --timeout "$TIMEOUT")"

    "$BIN/codex-state" append-attempt "$WORK" \
      --wave "$WAVE" --task "$num" \
      --impl "codex-$reasoning" \
      --session-id "$(cat "$sid_file" 2>/dev/null || echo '')" \
      --result "$status"

    if [ "$status" = "BLOCKED" ] || [ "$status" = "NEEDS_CONTEXT" ]; then
      gate_status="FAIL dispatch"
    else
      "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$num" --status gate-check
      GATE_ATTEMPT="$attempt" \
        gate_status="$("$BIN/codex-gate" \
          --worktree "$wt" \
          --work-dir "$WORK" \
          --wave "$WAVE" --task "$num" --task-slug "$slug" \
          --base "$BASE" \
          --test-cmd "$test_cmd")"
    fi

    if [ "$gate_status" = "PASS" ]; then
      "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$num" --status passed-gate
      return 0
    fi

    # gate failed — bump attempt
    findings="$WORK/findings.$WAVE.$num.$attempt.txt"
    attempt=$((attempt + 1))
    case "$attempt" in
      2) reasoning="high" ;;   # resume same session
      3) reasoning="xhigh" ;;  # resume same session at higher effort
      4)
        # Claude fallback
        "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$num" --status claude-fallback
        # write marker; wait for result
        jq -n \
          --argjson w "$WAVE" --argjson t "$num" \
          --arg slug "$slug" --arg wt "$wt" \
          --arg base "$BASE" --arg findings "$findings" \
          --arg plan_json "$PLAN_JSON" \
          --arg now "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          '{wave:$w, task:$t, slug:$slug, worktree_path:$wt, base:$base,
            findings_file:$findings, plan_json:$plan_json, requested_at:$now}' \
          > "$WORK/needs-claude-fallback.$WAVE.$num.json"
        # poll
        local waited=0
        while [ ! -r "$WORK/claude-fallback-result.$WAVE.$num.json" ]; do
          sleep 5; waited=$((waited + 5))
          if [ "$waited" -gt 1800 ]; then
            "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$num" --status escalated
            return 2
          fi
        done
        res="$(jq -r '.status' "$WORK/claude-fallback-result.$WAVE.$num.json")"
        rm -f "$WORK/claude-fallback-result.$WAVE.$num.json"
        if [ "$res" = "DONE" ] || [ "$res" = "DONE_WITH_CONCERNS" ]; then
          # re-run gate once for the fallback's work
          GATE_ATTEMPT="$attempt" \
          gate_status="$("$BIN/codex-gate" \
            --worktree "$wt" --work-dir "$WORK" \
            --wave "$WAVE" --task "$num" --task-slug "$slug" \
            --base "$BASE" --test-cmd "$test_cmd")"
          if [ "$gate_status" = "PASS" ]; then
            "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$num" --status passed-gate
            return 0
          fi
        fi
        "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$num" --status escalated
        return 2
        ;;
    esac
    # else loop, retry Codex with new reasoning + findings
  done
}

# Dispatch wave, with max-parallel ceiling.
declare -a active_pids=()
failed=0
for n in $wave_tasks; do
  process_one "$n" &
  active_pids+=("$!")
  # enforce ceiling
  while [ "${#active_pids[@]}" -ge "$MAX_PARALLEL" ]; do
    wait -n "${active_pids[@]}" || failed=$((failed + 1))
    # prune finished pids
    new=()
    for p in "${active_pids[@]}"; do
      kill -0 "$p" 2>/dev/null && new+=("$p") || true
    done
    active_pids=("${new[@]}")
  done
done

# wait for remaining
for p in "${active_pids[@]}"; do
  wait "$p" || failed=$((failed + 1))
done

if [ "$failed" -gt 0 ]; then
  echo "wave $WAVE: $failed task(s) escalated" >&2
  exit 2
fi
exit 0
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-run-wave
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-run-wave
git commit -m "codex-implement: parallel wave runner with retry ladder"
```

---

### Task 10: Wave merger (`codex-merge-wave`)

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-merge-wave`
- Create: `.claude/skills/gstack/codex/tests/test-merge-wave.sh`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-merge-wave.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
MERGE="$THIS_DIR/../bin/codex-merge-wave"
WTHELP="$THIS_DIR/../bin/codex-worktree"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cd "$TMP" && git init -q repo && cd repo
git config user.email t@t.t; git config user.name t
echo base > x.txt && git add x.txt && git commit -qm init
git checkout -qb basebranch

WORK="$TMP/work/plan"; mkdir -p "$WORK"
# create two worktrees with non-overlapping commits
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
  "waves": [{"wave": 1, "tasks": [1, 2]}]
}
EOF

cd "$TMP/repo"
"$MERGE" --work-dir "$WORK" --wave 1 --base basebranch --plan-json "$WORK/plan.json"

# both a.txt and b.txt should now exist on basebranch
git checkout -q basebranch
test -r a.txt || { echo "FAIL: a.txt missing"; exit 1; }
test -r b.txt || { echo "FAIL: b.txt missing"; exit 1; }

# commit log should have 2 squash-merge commits in declared order (task 1 then task 2)
log="$(git log --format='%s' -2 | head -n 10)"
echo "$log" | head -n 2 | grep -q 'task 2: beta'  || { echo "FAIL: latest commit wrong"; echo "$log"; exit 1; }
echo "$log" | tail -n 1 | grep -q 'task 1: alpha' || { echo "FAIL: earlier commit wrong"; echo "$log"; exit 1; }

echo "PASS: test-merge-wave"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-merge-wave.sh
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
.claude/skills/gstack/codex/tests/test-merge-wave.sh
```
Expected: FAIL — codex-merge-wave missing.

- [ ] **Step 3: Implement `codex-merge-wave`**

Create `.claude/skills/gstack/codex/bin/codex-merge-wave`:

```bash
#!/usr/bin/env bash
# Squash-merge each passed-gate task branch into the base branch in ascending
# task-number order. On conflict, abort that merge, mark the task BLOCKED with
# post-merge-conflict, and stop the wave.
#
# Flags:
#   --work-dir <dir>
#   --wave <N>
#   --base <ref>
#   --plan-json <file>
#
# After each successful merge, record `final_commit_on_base` in state.json and
# run the post-wave global test command. If red, escalate.
set -euo pipefail

WORK="" WAVE="" BASE="" PLAN_JSON=""
while [ $# -gt 0 ]; do
  case "$1" in
    --work-dir)  WORK="$2"; shift 2 ;;
    --wave)      WAVE="$2"; shift 2 ;;
    --base)      BASE="$2"; shift 2 ;;
    --plan-json) PLAN_JSON="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
: "${WORK:?}" "${WAVE:?}" "${BASE:?}" "${PLAN_JSON:?}"

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$SKILL_DIR/bin"

# tasks in ascending task-number order
tasks="$(jq -r --argjson w "$WAVE" '.waves[] | select(.wave == $w) | .tasks | sort | .[]' "$PLAN_JSON")"
plan_slug="$(basename "$WORK")"
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

git checkout -q "$BASE"

for n in $tasks; do
  slug="$(jq -r --argjson n "$n" '.tasks[] | select(.num == $n) | .slug' "$PLAN_JSON")"
  heading="$(jq -r --argjson n "$n" '.tasks[] | select(.num == $n) | .heading' "$PLAN_JSON")"
  branch="codex/$plan_slug/$slug"

  if ! git merge --squash "$branch" 2>/dev/null; then
    git merge --abort || true
    "$BIN/codex-state" set-status "$WORK" --wave "$WAVE" --task "$n" --status blocked
    echo "ESCALATE wave=$WAVE task=$n reason=post-merge-conflict" >&2
    exit 2
  fi

  msg="task $n: $heading

via /codex implement

Co-Authored-By: Codex (gpt-5-codex) <noreply@openai.com>
Co-Authored-By: Claude (claude-opus-4-6) <noreply@anthropic.com>"
  git commit -qm "$msg"
  sha="$(git rev-parse HEAD)"
  "$BIN/codex-state" set-task-commit "$WORK" --wave "$WAVE" --task "$n" --sha "$sha"
  "$BIN/codex-state" set-status      "$WORK" --wave "$WAVE" --task "$n" --status merged

  # tear down worktree + branch now that its contents are on base
  "$BIN/codex-worktree" teardown "$WORK" "$slug" > /dev/null
done

"$BIN/codex-state" set-wave-status "$WORK" --wave "$WAVE" --status completed

# Post-wave global test
global_test="$(jq -r '.test_command' "$PLAN_JSON")"
if [ -n "$global_test" ] && [ "$global_test" != "null" ]; then
  if ! bash -c "$global_test"; then
    echo "ESCALATE wave=$WAVE reason=post-wave-global-test-failed" >&2
    exit 2
  fi
fi

exit 0
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-merge-wave
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-merge-wave.sh
```
Expected: PASS: test-merge-wave

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-merge-wave \
        .claude/skills/gstack/codex/tests/test-merge-wave.sh
git commit -m "codex-implement: squash-merge wave with global post-merge test"
```

---

### Task 11: Top-level orchestrator (`codex-implement`) + preflight + dry-run

**Files:**
- Create: `.claude/skills/gstack/codex/bin/codex-implement`
- Create: `.claude/skills/gstack/codex/tests/test-preflight.sh`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-preflight.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL="$THIS_DIR/../bin/codex-implement"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

cd "$TMP" && git init -q && git config user.email t@t.t && git config user.name t
echo a > a.txt && git add a.txt && git commit -qm init
git checkout -qb main

# Dirty tree: preflight should refuse.
echo dirt > dirt.txt

if CODEX_BIN="$THIS_DIR/codex-fake" GSTACK_HOME="$TMP/.gstack" \
     "$IMPL" --dry-run "$THIS_DIR/fixtures/happy.md" 2> "$TMP/err"; then
  echo "FAIL: expected refusal on dirty tree"; exit 1
fi
grep -q "clean" "$TMP/err" || { echo "FAIL: missing 'clean' in err"; exit 1; }

# Clean the tree
rm dirt.txt

# Dry-run should parse + print summary, no dispatch, exit 0
CODEX_BIN="$THIS_DIR/codex-fake" GSTACK_HOME="$TMP/.gstack" \
  "$IMPL" --dry-run "$THIS_DIR/fixtures/happy.md" > "$TMP/out"

grep -q "waves: 2" "$TMP/out" || { echo "FAIL: summary shape"; cat "$TMP/out"; exit 1; }
grep -q "Wave 1: 2 task(s)" "$TMP/out" || { echo "FAIL: wave 1 line"; exit 1; }

echo "PASS: test-preflight"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-preflight.sh
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
.claude/skills/gstack/codex/tests/test-preflight.sh
```
Expected: FAIL — codex-implement missing.

- [ ] **Step 3: Implement `codex-implement`**

Create `.claude/skills/gstack/codex/bin/codex-implement`:

```bash
#!/usr/bin/env bash
# /codex implement entry point. Orchestrates parse → per-wave run → per-wave merge.
#
# Usage:
#   codex-implement <plan-file> [options]
#
# Options:
#   --base <ref>          default origin/main (auto-falls-back to main)
#   --dry-run             parse-only, print summary, exit 0
#   --resume              resume from state.json
#   --rollback            revert every merged commit (see --rollback doc)
#   --only-task N         limit to a single task (for canary runs)
#   --max-parallel N      fan-out ceiling, default 4
#   --task-timeout SEC    default 1800
#   --force               bypass plan-sha mismatch on --resume
#   --force-clean         also clean orphan worktrees before starting
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$SKILL_DIR/bin"

GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"
WORK_ROOT="$GSTACK_HOME/codex-work"
mkdir -p "$WORK_ROOT"

PLAN=""
BASE=""; DRY=0; RESUME=0; ROLLBACK=0; ONLY_TASK=""
MAX_PAR=4; TO=1800; FORCE=0; FORCE_CLEAN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --base)         BASE="$2"; shift 2 ;;
    --dry-run)      DRY=1; shift ;;
    --resume)       RESUME=1; shift ;;
    --rollback)     ROLLBACK=1; shift ;;
    --only-task)    ONLY_TASK="$2"; shift 2 ;;
    --max-parallel) MAX_PAR="$2"; shift 2 ;;
    --task-timeout) TO="$2"; shift 2 ;;
    --force)        FORCE=1; shift ;;
    --force-clean)  FORCE_CLEAN=1; shift ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *)  PLAN="$1"; shift ;;
  esac
done
[ -r "$PLAN" ] || { echo "usage: codex-implement <plan-file> [...]" >&2; exit 2; }

plan_slug="$(basename "$PLAN" .md)"
WORK="$WORK_ROOT/$plan_slug"
mkdir -p "$WORK"

# --- preflight ---
preflight() {
  if [ "$DRY" -eq 0 ] && [ "$ROLLBACK" -eq 0 ]; then
    # clean tree required
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      echo "ERROR: working tree is not clean. Commit or stash before running." >&2
      exit 2
    fi
    # codex on PATH
    if ! command -v "${CODEX_BIN:-codex}" >/dev/null 2>&1; then
      echo "ERROR: codex CLI not found on PATH" >&2; exit 2
    fi
    # git worktree available
    if ! git worktree list >/dev/null 2>&1; then
      echo "ERROR: git worktree is not available (need Git >= 2.5)" >&2; exit 2
    fi
  fi
}

# --- acquire lock ---
LOCK="$WORK/lock"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK"
  if ! flock -n 9; then
    echo "ERROR: another /codex implement run is active on this plan." >&2
    exit 2
  fi
fi

# --- parse plan ---
PLAN_JSON="$WORK/plan.json"
"$BIN/codex-parse-plan" "$PLAN" > "$PLAN_JSON"

# --- resolve base if not given ---
if [ -z "$BASE" ]; then
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    BASE="origin/main"
  else
    BASE="main"
  fi
fi

# --- dry-run ---
if [ "$DRY" -eq 1 ]; then
  waves="$(jq '.waves | length' "$PLAN_JSON")"
  tasks="$(jq '.tasks | length' "$PLAN_JSON")"
  printf 'plan: %s\ntasks: %d\nwaves: %d\nbase: %s\n' "$PLAN" "$tasks" "$waves" "$BASE"
  jq -r '.waves[] | "Wave \(.wave): \(.tasks | length) task(s) — " + (.tasks | map(tostring) | join(", "))' "$PLAN_JSON"
  exit 0
fi

preflight

# --- rollback ---
if [ "$ROLLBACK" -eq 1 ]; then
  STATE="$WORK/state.json"
  [ -r "$STATE" ] || { echo "nothing to roll back"; exit 0; }
  # collect merged shas, reverse order (portable: awk reversal, no `tac`)
  shas="$(jq -r '.waves[].tasks[] | select(.final_commit_on_base != null) | .final_commit_on_base' "$STATE" \
          | awk '{a[NR]=$0} END{for(i=NR;i>=1;i--) print a[i]}')"
  git checkout -q "$BASE"
  for s in $shas; do
    git revert --no-edit "$s"
  done
  rm -rf "$WORK"
  echo "rollback complete; state dir removed"
  exit 0
fi

# --- resume check ---
STATE="$WORK/state.json"
if [ "$RESUME" -eq 1 ]; then
  [ -r "$STATE" ] || { echo "ERROR: --resume but no state.json"; exit 2; }
  recorded_sha="$(jq -r '.plan_sha' "$STATE")"
  current_sha="$(shasum -a 256 "$PLAN" | cut -d' ' -f1)"
  if [ "$FORCE" -eq 0 ] && [ "$recorded_sha" != "$current_sha" ]; then
    echo "ERROR: plan was edited since run started (use --force to override)" >&2
    exit 2
  fi
else
  [ -e "$STATE" ] && { echo "ERROR: state.json exists. Use --resume or --force-clean."; exit 2; }
  plan_sha="$(shasum -a 256 "$PLAN" | cut -d' ' -f1)"
  base_sha="$(git rev-parse "$BASE")"
  waves_arr="$(jq '.waves' "$PLAN_JSON")"
  tasks_arr="$(jq '.tasks | map({num, slug})' "$PLAN_JSON")"
  "$BIN/codex-state" init "$WORK" \
    --plan-path "$PLAN" --plan-sha "$plan_sha" \
    --base-ref "$BASE"  --base-sha "$base_sha" \
    --waves "$waves_arr" --tasks "$tasks_arr"
fi

# --- orphan-worktree cleanup ---
if [ "$FORCE_CLEAN" -eq 1 ]; then
  for s in $(jq -r '.tasks[].slug' "$PLAN_JSON"); do
    "$BIN/codex-worktree" teardown "$WORK" "$s" > /dev/null || true
  done
fi

# --- run each wave ---
total_waves="$(jq '.waves | length' "$PLAN_JSON")"
for wave in $(seq 1 "$total_waves"); do
  wstate="$(jq -r --argjson w "$wave" '.waves[] | select(.wave == $w) | .status' "$STATE")"
  if [ "$wstate" = "completed" ]; then
    echo "[WAVE $wave/$total_waves] skipped (already completed)"
    continue
  fi
  "$BIN/codex-state" set-wave-status "$WORK" --wave "$wave" --status in_progress
  echo "[WAVE $wave/$total_waves] starting"

  if ! "$BIN/codex-run-wave" \
        --work-dir "$WORK" --wave "$wave" --base "$BASE" \
        --plan-json "$PLAN_JSON" --max-parallel "$MAX_PAR" \
        --task-timeout "$TO"; then
    echo "[WAVE $wave] escalated; state checkpointed at $STATE"
    exit 2
  fi

  if ! "$BIN/codex-merge-wave" \
        --work-dir "$WORK" --wave "$wave" --base "$BASE" \
        --plan-json "$PLAN_JSON"; then
    echo "[WAVE $wave] merge or post-wave test failed; state checkpointed"
    exit 2
  fi
done

echo "all waves complete. merged commits on $BASE:"
jq -r '.waves[].tasks[] | select(.final_commit_on_base != null) | "  \(.num) \(.slug) → \(.final_commit_on_base[0:8])"' "$STATE"
```

```bash
chmod +x .claude/skills/gstack/codex/bin/codex-implement
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
.claude/skills/gstack/codex/tests/test-preflight.sh
```
Expected: PASS: test-preflight

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-implement \
        .claude/skills/gstack/codex/tests/test-preflight.sh
git commit -m "codex-implement: top-level orchestrator + preflight + dry-run"
```

---

### Task 12: Rollback integration test

**Files:**
- Create: `.claude/skills/gstack/codex/tests/test-rollback.sh`
- Create: `.claude/skills/gstack/codex/tests/fixtures/rollback-plan.md`

This test exercises a full happy-path run followed by `--rollback`, asserting that
the revert chain lands correctly on the base branch. Resume semantics (crash
mid-run → restart) are exercised manually during rollout Phase 2 because the
programmatic setup (killing the orchestrator mid-wave deterministically) is
fragile in CI — the self-review notes below flag this as accepted scope.

- [ ] **Step 1: Write the fixture plan**

Create `.claude/skills/gstack/codex/tests/fixtures/rollback-plan.md`:

````markdown
# Rollback Test Plan

**Goal:** verify /codex implement --rollback reverts merged commits.

**Architecture:** two tasks in one wave.

**Test command:** `test -r ra.txt && test -r rb.txt`

## Parallelization

- Wave 1: Tasks 1, 2

### Task 1: first

**Files:**
- Create: `ra.txt`

- [ ] **Step 1: Create ra.txt**

Run: `true`

### Task 2: second

**Files:**
- Create: `rb.txt`

- [ ] **Step 1: Create rb.txt**

Run: `true`
````

- [ ] **Step 2: Write the rollback test**

Create `.claude/skills/gstack/codex/tests/test-rollback.sh`:

```bash
#!/usr/bin/env bash
# Full happy-path run, then --rollback; assert the revert chain lands.
set -euo pipefail
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL="$THIS_DIR/../bin/codex-implement"
TMP="$(mktemp -d)"; trap 'kill $SIM_PID 2>/dev/null || true; rm -rf "$TMP"' EXIT

cd "$TMP" && git init -q && git config user.email t@t.t && git config user.name t
echo base > base.txt && git add base.txt && git commit -qm init
git checkout -qb main

# stubs directory
mkdir -p "$TMP/stubs"

# fake codex: for any prompt mentioning ra.txt or rb.txt, create+commit that file
cat > "$TMP/stubs/codex" <<'EOF'
#!/usr/bin/env bash
prompt="$*"
for f in ra.txt rb.txt; do
  if echo "$prompt" | grep -q "$f"; then
    echo x > "$f"
    git add "$f"
    git -c user.email=t@t.t -c user.name=t commit -qm "fake $f"
  fi
done
echo DONE
EOF
chmod +x "$TMP/stubs/codex"

# stage-2 gate stub: always PASS
cat > "$TMP/stubs/codex-gate-review" <<'EOF'
#!/usr/bin/env bash
echo PASS
EOF
chmod +x "$TMP/stubs/codex-gate-review"

export PATH="$TMP/stubs:$PATH"
GSTACK_HOME="$TMP/.gstack"
export GSTACK_HOME

# background Claude-simulator: writes spec-check-result for every needs-spec-check
WORK="$GSTACK_HOME/codex-work/rollback-plan"
(
  while :; do
    for f in "$WORK"/needs-spec-check.*.json 2>/dev/null; do
      [ -r "$f" ] || continue
      result="${f//needs-spec-check./spec-check-result.}"
      printf '{"verdict":"PASS","findings_text":"ok","completed_at":"now"}\n' > "$result.tmp"
      mv "$result.tmp" "$result"
      rm -f "$f"
    done
    sleep 1
  done
) &
SIM_PID=$!

# ----- happy-path run -----
"$IMPL" --base main "$THIS_DIR/fixtures/rollback-plan.md"

git checkout -q main
test -r ra.txt || { echo "FAIL: ra.txt missing pre-rollback"; exit 1; }
test -r rb.txt || { echo "FAIL: rb.txt missing pre-rollback"; exit 1; }

# capture how many commits currently on main (should be: init + 2 squash = 3)
pre_count="$(git rev-list --count main)"
[ "$pre_count" = "3" ] || { echo "FAIL: expected 3 commits, got $pre_count"; exit 1; }

# ----- rollback -----
"$IMPL" --base main --rollback "$THIS_DIR/fixtures/rollback-plan.md"

# After rollback: the two created files should be gone AND two revert commits added
test ! -e ra.txt || { echo "FAIL: ra.txt still present after rollback"; exit 1; }
test ! -e rb.txt || { echo "FAIL: rb.txt still present after rollback"; exit 1; }

post_count="$(git rev-list --count main)"
[ "$post_count" = "5" ] || { echo "FAIL: expected 5 commits after rollback, got $post_count"; exit 1; }

# The 2 most recent commits should be reverts
git log --format='%s' -2 | grep -q "^Revert" || { echo "FAIL: last 2 commits not reverts"; git log --format='%s' -4; exit 1; }

# state dir should be cleaned up
test ! -d "$WORK" || { echo "FAIL: state dir not removed"; exit 1; }

echo "PASS: test-rollback"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-rollback.sh
```

- [ ] **Step 3: Run the test**

```bash
.claude/skills/gstack/codex/tests/test-rollback.sh
```
Expected: PASS: test-rollback

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gstack/codex/tests/test-rollback.sh \
        .claude/skills/gstack/codex/tests/fixtures/rollback-plan.md
git commit -m "codex-implement: rollback integration test"
```

---

### Task 13: SKILL.md Step 2D integration + docs

**Files:**
- Modify: `.claude/skills/gstack/codex/SKILL.md` (add Step 2D; update description)
- Modify: `.claude/skills/gstack/codex/SKILL.md.tmpl` (mirror same edits)
- Modify: `CLAUDE.md` (add one-line note)

- [ ] **Step 1: Update description line in SKILL.md**

Find the block starting with `description: |` in the frontmatter of `.claude/skills/gstack/codex/SKILL.md` and change:

```
  OpenAI Codex CLI wrapper — three modes. Code review: independent diff review via
  codex review with pass/fail gate. Challenge: adversarial mode that tries to break
  your code. Consult: ask codex anything with session continuity for follow-ups.
```

to:

```
  OpenAI Codex CLI wrapper — four modes. Code review: independent diff review via
  codex review with pass/fail gate. Challenge: adversarial mode that tries to break
  your code. Consult: ask codex anything with session continuity for follow-ups.
  Implement: parallel plan orchestrator that dispatches codex exec -s workspace-write
  per task in git worktrees, with a 3-stage merge gate and retry ladder.
```

Also update the trigger line just below:

```
  The "200 IQ autistic developer" second opinion. Use when asked to "codex review",
  "codex challenge", "ask codex", "second opinion", "consult codex", or "codex implement".
```

- [ ] **Step 2: Update Step 1: Detect mode**

Find the block "## Step 1: Detect mode" in SKILL.md and replace its numbered parse list:

```
1. `/codex review` or `/codex review <instructions>` — **Review mode** (Step 2A)
2. `/codex challenge` or `/codex challenge <focus>` — **Challenge mode** (Step 2B)
4. `/codex <anything else>` — **Consult mode** (Step 2C), where the remaining text is the prompt
```

with:

```
1. `/codex review` or `/codex review <instructions>` — **Review mode** (Step 2A)
2. `/codex challenge` or `/codex challenge <focus>` — **Challenge mode** (Step 2B)
3. `/codex implement <plan-file>` or `/codex implement <plan-file> <flags>` — **Implement mode** (Step 2D)
4. `/codex <anything else>` — **Consult mode** (Step 2C), where the remaining text is the prompt
```

- [ ] **Step 3: Add Step 2D section to SKILL.md**

After the end of `## Step 2C: Consult Mode` and before the next top-level section (e.g. the telemetry section or whatever follows it), insert:

```markdown
## Step 2D: Implement Mode

Plan orchestrator. Executes an approved superpowers-style implementation plan in
parallel waves via `codex exec -s workspace-write` per task in isolated git
worktrees. See
`.claude/skills/gstack/codex/PROTOCOL.md` for the full bash ↔ Claude marker
protocol the orchestrator relies on, and
`docs/superpowers/specs/2026-04-15-codex-implement-orchestrator-design.md`
for the full design.

### Invocation

```bash
.claude/skills/gstack/codex/bin/codex-implement <plan-file> [options]
```

Options:
- `--base <ref>` — base branch (default `origin/main`, falls back to `main`).
- `--dry-run` — parse the plan, print wave+task summary, exit. No dispatch.
- `--resume` — resume from a checkpointed `state.json` after a crash/escalation.
- `--rollback` — revert every merged commit recorded in state.json.
- `--only-task N` — execute a single task (canary runs).
- `--max-parallel N` — fan-out ceiling (default 4).
- `--task-timeout SEC` — per-Codex-call timeout (default 1800).
- `--force` — override plan-sha mismatch on resume.
- `--force-clean` — clean orphan worktrees before starting.

### What Claude must do while it runs

During a run, the orchestrator creates marker files in
`~/.gstack/codex-work/<plan-slug>/` that require Claude (the coordinating
session) to act on:

- `needs-spec-check.<wave>.<task>.json` — Claude dispatches a Task() subagent
  using `spec-reviewer-prompt.md`, writes result to
  `spec-check-result.<wave>.<task>.json`, removes the `needs-*` file.
- `needs-claude-fallback.<wave>.<task>.json` — Claude dispatches a Task()
  implementer using `codex-fallback-prompt.md` in the specified worktree,
  writes result to `claude-fallback-result.<wave>.<task>.json`, removes the
  `needs-*` file.

Poll the work dir every ~5 seconds; the bash orchestrator blocks on these
handoffs with a 15-min budget per spec check and 30-min per fallback.

### Plan parallelization convention

Plans opting into `/codex implement` include a `## Parallelization` section
(see design spec). Plans without this section fall back to fully-serial execution
with a warning.
```

- [ ] **Step 4: Mirror edits to SKILL.md.tmpl**

Apply the same three edits (description-line, Step 1 mode list, Step 2D insertion) to `.claude/skills/gstack/codex/SKILL.md.tmpl`.

- [ ] **Step 5: Update nanoclaw `CLAUDE.md`**

In `CLAUDE.md`, find the `## gstack` section's skill table. For the `/codex` row, change the `Purpose` cell from `Codex workflow` to `Codex workflow (review, challenge, consult, implement)`.

- [ ] **Step 6: Verify SKILL.md still parses**

```bash
awk '/^---$/{c++} c==2{exit} c==1{print}' .claude/skills/gstack/codex/SKILL.md | head -20
```
Expected: YAML frontmatter intact (name, description, allowed-tools present).

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/gstack/codex/SKILL.md \
        .claude/skills/gstack/codex/SKILL.md.tmpl \
        CLAUDE.md
git commit -m "codex-implement: SKILL.md Step 2D + CLAUDE.md reference"
```

---

### Task 14: End-to-end integration test

**Files:**
- Create: `.claude/skills/gstack/codex/tests/test-e2e.sh`
- Create: `.claude/skills/gstack/codex/tests/fixtures/e2e-plan.md`

- [ ] **Step 1: Write the e2e fixture plan**

Create `.claude/skills/gstack/codex/tests/fixtures/e2e-plan.md`:

````markdown
# E2E Test Plan

**Goal:** verify /codex implement end to end using a scripted fake codex.

**Architecture:** two tasks in one wave, each creates one file.

**Test command:** `test -r a.txt && test -r b.txt`

## Parallelization

- Wave 1: Tasks 1, 2

### Task 1: alpha file

**Files:**
- Create: `a.txt`

- [ ] **Step 1: Create a.txt**

Run: `echo a > a.txt && git add a.txt && git -c user.email=t@t.t -c user.name=t commit -qm 'add a'`

### Task 2: beta file

**Files:**
- Create: `b.txt`

- [ ] **Step 1: Create b.txt**

Run: `echo b > b.txt && git add b.txt && git -c user.email=t@t.t -c user.name=t commit -qm 'add b'`
````

- [ ] **Step 2: Write the e2e test**

Create `.claude/skills/gstack/codex/tests/test-e2e.sh`:

```bash
#!/usr/bin/env bash
# End-to-end: scripted fake codex + scripted spec-check-result writer.
# Drives the orchestrator through a 2-task wave and asserts both files
# land on main via squash commits in ascending task-number order.
set -euo pipefail

THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
IMPL="$THIS_DIR/../bin/codex-implement"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# test repo
cd "$TMP" && git init -q && git config user.email t@t.t && git config user.name t
echo base > base.txt && git add base.txt && git commit -qm init
git checkout -qb main

# stub codex: actually writes the file named in the worktree's task
cat > "$TMP/stubs/codex" <<'EOF'
#!/usr/bin/env bash
# Very simple fake: if prompt mentions "a.txt", touch it; if "b.txt", touch it.
prompt="$*"
if echo "$prompt" | grep -q "a.txt"; then
  echo a > a.txt && git add a.txt && git -c user.email=t@t.t -c user.name=t commit -qm "fake task 1" 2>/dev/null
elif echo "$prompt" | grep -q "b.txt"; then
  echo b > b.txt && git add b.txt && git -c user.email=t@t.t -c user.name=t commit -qm "fake task 2" 2>/dev/null
fi
echo DONE
EOF
mkdir -p "$TMP/stubs"
# above wrote outside $TMP/stubs by mistake; redo properly
rm -f "$TMP/stubs/codex"
cat > "$TMP/stubs/codex" <<'EOF'
#!/usr/bin/env bash
prompt="$*"
if echo "$prompt" | grep -q "a.txt"; then
  echo a > a.txt && git add a.txt && git -c user.email=t@t.t -c user.name=t commit -qm "fake task 1"
elif echo "$prompt" | grep -q "b.txt"; then
  echo b > b.txt && git add b.txt && git -c user.email=t@t.t -c user.name=t commit -qm "fake task 2"
fi
echo DONE
EOF
chmod +x "$TMP/stubs/codex"

# stub codex review: always PASS
cat > "$TMP/stubs/codex-gate-review" <<'EOF'
#!/usr/bin/env bash
echo PASS
EOF
chmod +x "$TMP/stubs/codex-gate-review"

# A background "Claude simulator": watches the work dir and writes
# spec-check-result files as soon as needs-spec-check markers appear.
WORK="$TMP/.gstack/codex-work/e2e-plan"
(
  while :; do
    for f in "$WORK"/needs-spec-check.*.json; do
      [ -r "$f" ] || continue
      result="${f//needs-spec-check./spec-check-result.}"
      echo '{"verdict":"PASS","findings_text":"ok","completed_at":"now"}' > "$result.tmp"
      mv "$result.tmp" "$result"
      rm -f "$f"
    done
    sleep 1
  done
) &
SIM_PID=$!
trap 'kill $SIM_PID 2>/dev/null; rm -rf "$TMP"' EXIT

export PATH="$TMP/stubs:$PATH"
GSTACK_HOME="$TMP/.gstack"
export GSTACK_HOME

"$IMPL" --base main "$THIS_DIR/fixtures/e2e-plan.md"

# Assert the files landed on main
git checkout -q main
test -r a.txt || { echo "FAIL: a.txt missing"; exit 1; }
test -r b.txt || { echo "FAIL: b.txt missing"; exit 1; }

# Assert squash-commit order: task 1 first (oldest), then task 2 (newest)
# git log -2 emits newest first; portable reversal via awk.
last2="$(git log --format='%s' -2 | awk '{a[NR]=$0} END{for(i=NR;i>=1;i--) print a[i]}')"
echo "$last2" | head -n 1 | grep -q "task 1: alpha file" || { echo "FAIL: task 1 first commit wrong"; echo "$last2"; exit 1; }
echo "$last2" | tail -n 1 | grep -q "task 2: beta file"  || { echo "FAIL: task 2 second commit wrong"; echo "$last2"; exit 1; }

echo "PASS: test-e2e"
```

```bash
chmod +x .claude/skills/gstack/codex/tests/test-e2e.sh
```

- [ ] **Step 3: Run the full suite**

```bash
.claude/skills/gstack/codex/tests/run-all.sh
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gstack/codex/tests/test-e2e.sh \
        .claude/skills/gstack/codex/tests/fixtures/e2e-plan.md
git commit -m "codex-implement: end-to-end integration test"
```

---

## Self-Review Notes

- **Spec coverage.** Every section of the spec maps to one or more tasks: architecture → T1/T11/T13; plan parsing → T2; dispatch + retry → T5/T8/T9; merge gate → T6/T7/T8/T10; state → T3; resume/rollback → T11/T12; testing → T1/T14; rollout → (not code; documented in spec + SKILL.md).
- **Test coverage gaps (accepted).** Resume semantics (mid-wave crash → `--resume` completes the remaining work) are covered only by manual smoke during rollout Phase 2. Programmatic testing requires a deterministic way to kill the orchestrator mid-wave and a reliable resume entry point; both are possible but would roughly double the test footprint for a feature we'll exercise by hand within the first week anyway. Rollback is covered fully (T12). Happy-path end-to-end is covered fully (T14).
- **Bash/jq caveats.** The `awk` + `jq` in `codex-parse-plan` is dense. If the T2 implementer finds the awk state machine gets wedged on a real plan, they are explicitly allowed to replace it with a small Python 3 script preserving the same stdout JSON contract — this is a localized tooling choice, not a scope change.
- **Bash version.** Task 9 (`codex-run-wave`) uses `wait -n`, which requires bash 4.3+. macOS ships bash 3.2 by default. Implementers on macOS must run the orchestrator under `bash` installed via Homebrew (`brew install bash`). The plan's Tech Stack line declares bash 5+; add a preflight check to `codex-implement` if the version gap causes silent errors in early runs.
- **`flock` on macOS.** macOS ships `shlock`, not `flock`. `codex-state` has a PID-file fallback, but the primary orchestrator lock in `codex-implement` Step 3 uses `flock` unconditionally — on macOS this silently fails open. Fix before Phase 3 by either installing util-linux `flock` via Homebrew or adding a fallback in `codex-implement`.
- **Session-id capture.** Codex CLI may print session IDs to its human log rather than the JSONL stream. If `--session-file` is empty after the first attempt, attempts 2/3 silently degrade to fresh sessions — acceptable for v1 but note for telemetry. If session resume becomes unreliable, retry attempts can fall back to fresh sessions with full findings context (retries are still purposeful, just more expensive).
- **Claude side of the loop.** The plan assumes the executing agent (Claude) handles `needs-spec-check.*.json` and `needs-claude-fallback.*.json` markers per `PROTOCOL.md`. `superpowers:subagent-driven-development` execution honors this naturally because Claude is already the coordinator between each task's subagent. `superpowers:executing-plans` mode would require Claude to set up a background watcher (e.g. a `while :; do …` bash loop spawned via the Bash tool with `run_in_background=true`) before kicking off each wave. Prefer subagent-driven-development for execution.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-15-codex-implement-orchestrator.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
