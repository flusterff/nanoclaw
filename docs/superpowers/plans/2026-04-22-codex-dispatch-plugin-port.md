# Codex Dispatch Plugin Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `/codex implement`'s task-dispatch layer from direct `codex exec` shell-out to the `codex-plugin-cc` plugin's runtime (`codex-companion.mjs task`), gaining upstream-maintained plumbing + structured JSON output + job tracking, without touching the 2,236 LOC of wave orchestration.

**Architecture:** Narrow-surface full rewrite of `codex-dispatch-task` (115→~130 LOC). Add new test fake (`codex-companion-fake.mjs`, ~50 LOC) that delegates to `$CODEX_BIN` so existing side-effectful test stubs remain the source of truth. Two one-line additions to `codex-run-wave` to recognize a new `PLUGIN_ERROR` status and pass `--findings-out` so dispatch can write synthesized findings for the next attempt. Preserve every existing orchestrator invariant (marker files, canary-revert, rollback, state.json schema).

**Tech Stack:** Bash (dispatch + orchestrator), Node.js (new fake + plugin runtime), jq (dispatch parser), existing shell test harness.

**Spec:** [`docs/superpowers/specs/2026-04-22-codex-dispatch-plugin-port-design.md`](../specs/2026-04-22-codex-dispatch-plugin-port-design.md) — rev 4.

---

## File Structure

### Created

- `tests/codex-companion-fake.mjs` — new test fake, thin subprocess shim over `${CODEX_BIN:-codex}` wrapping stdout in plugin-shape JSON.

### Modified

- `bin/codex-dispatch-task` — full rewrite (all 115 lines replaced).
- `bin/codex-run-wave` — two one-line additions (lines 428 and 437).
- `tests/test-dispatch-task.sh` — update fixture to emit plugin-shape JSON instead of codex JSONL; add `CODEX_COMPANION` export.
- `tests/test-render-prompt-ampersand.sh` — add `CODEX_COMPANION` export.
- `tests/test-e2e.sh` — add `CODEX_COMPANION` export.
- `tests/test-cross-wave.sh` — add `CODEX_COMPANION` export.
- `tests/test-claude-fallback.sh` — add `CODEX_COMPANION` export.
- `tests/test-post-wave-recovery.sh` — add `CODEX_COMPANION` export.
- `tests/test-resume-cleanup.sh` — add `CODEX_COMPANION` export.
- `tests/test-resume-claude-fallback.sh` — add `CODEX_COMPANION` export.
- `tests/test-only-task.sh` — add `CODEX_COMPANION` export.
- `tests/test-preflight.sh` — add `CODEX_COMPANION` export.

### Untouched (enumerated so reviewers know nothing silently moves)

- `bin/codex-implement`, `bin/codex-merge-wave`, `bin/codex-gate`, `bin/codex-gate-review`, `bin/codex-parse-plan`, `bin/codex-state`, `bin/codex-worktree`
- All prompt files (`codex-implementer-prompt.md`, `codex-fallback-prompt.md`, `spec-reviewer-prompt.md`)
- `tests/codex-fake` — still used by `$CODEX_BIN`-stubbing tests (the shim delegates to it)
- `tests/test-codex-fake.sh`, `tests/test-gate.sh`, `tests/test-gate-review.sh`, `tests/test-merge-wave.sh`, `tests/test-parse-plan.sh`
- `state.json` schema

All file paths in tasks below are relative to `.claude/skills/gstack/codex/` unless otherwise specified. Absolute root: `/Users/will/nanoclaw/.claude/skills/gstack/codex/`.

---

## Task 1: Commit the spec to the feature branch

**Files:**
- Commit: `docs/superpowers/specs/2026-04-22-codex-dispatch-plugin-port-design.md` (already in worktree; staged but unversioned)

- [ ] **Step 1: Verify worktree + branch state**

Run from the feature-branch worktree root (`/Users/will/nanoclaw/.worktrees/feat-codex-dispatch-plugin-port`):

```bash
cd /Users/will/nanoclaw/.worktrees/feat-codex-dispatch-plugin-port
git status --short
git branch --show-current
git log --oneline -3
```

Expected: current branch `feat/codex-dispatch-plugin-port`, HEAD at `1f3d6c7`, working-tree shows untracked `docs/superpowers/specs/2026-04-22-codex-dispatch-plugin-port-design.md`.

- [ ] **Step 2: Commit the spec**

```bash
git add docs/superpowers/specs/2026-04-22-codex-dispatch-plugin-port-design.md
git commit -m "$(cat <<'EOF'
plan: codex-dispatch-plugin-port design spec rev 4

Ported /codex implement dispatch from codex exec shell-out to codex-plugin-cc
plugin's task runtime. Survived 3 rounds of adversarial codex review (threads
019db442..., 019db450..., 019db457...).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log --oneline -1
git show --stat HEAD
```

Expected: one commit, one file changed (+~500 lines in docs/superpowers/specs/).

---

## Task 2: Create `tests/codex-companion-fake.mjs` — payload mode only

Minimal fake that supports the direct-payload override (`CODEX_COMPANION_FAKE_PAYLOAD`). Subprocess delegation comes in Task 3.

**Files:**
- Create: `.claude/skills/gstack/codex/tests/codex-companion-fake.mjs`

- [ ] **Step 1: Write the failing test**

Create `.claude/skills/gstack/codex/tests/test-codex-companion-fake.sh`:

```bash
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
```

```bash
chmod +x "$THIS_DIR/test-codex-companion-fake.sh"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/will/nanoclaw/.worktrees/feat-codex-dispatch-plugin-port
bash .claude/skills/gstack/codex/tests/test-codex-companion-fake.sh
```

Expected: FAIL — `codex-companion-fake.mjs` does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `.claude/skills/gstack/codex/tests/codex-companion-fake.mjs`:

```javascript
#!/usr/bin/env node
// Test stand-in for codex-plugin-cc's codex-companion.mjs.
// Modes (evaluated in order):
//   1. CODEX_COMPANION_FAKE_PAYLOAD: emit that JSON file verbatim to stdout
//   2. (Task 3) spawn ${CODEX_BIN:-codex} with prompt, wrap stdout as plugin JSON
//   3. (Task 3) if no codex binary resolves, emit {"status":1,...} so tests fail loud
//
// Exit code: CODEX_COMPANION_FAKE_EXIT if set, else 0.
// Side log: if CODEX_COMPANION_FAKE_LOG is set, append argv to that file.
import fs from "node:fs";
import process from "node:process";

if (process.env.CODEX_COMPANION_FAKE_LOG) {
  fs.appendFileSync(
    process.env.CODEX_COMPANION_FAKE_LOG,
    `argv: ${process.argv.slice(2).join(" ")}\n`
  );
}

const payloadPath = process.env.CODEX_COMPANION_FAKE_PAYLOAD;
if (payloadPath && fs.existsSync(payloadPath)) {
  process.stdout.write(fs.readFileSync(payloadPath, "utf8"));
  const exitCode = process.env.CODEX_COMPANION_FAKE_EXIT
    ? parseInt(process.env.CODEX_COMPANION_FAKE_EXIT, 10)
    : 0;
  process.exit(exitCode);
}

// Subprocess-delegation mode lands in Task 3.
process.stderr.write("codex-companion-fake: TODO Task 3 implementation\n");
process.exit(2);
```

```bash
chmod +x .claude/skills/gstack/codex/tests/codex-companion-fake.mjs
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bash .claude/skills/gstack/codex/tests/test-codex-companion-fake.sh
```

Expected: `PASS: test-codex-companion-fake (payload mode)`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/tests/codex-companion-fake.mjs \
        .claude/skills/gstack/codex/tests/test-codex-companion-fake.sh
git commit -m "$(cat <<'EOF'
test: add codex-companion-fake.mjs with payload mode

First slice — direct payload override mode only. Subprocess-delegation
and fail-loud modes land in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend fake with subprocess delegation + fail-loud mode

**Files:**
- Modify: `.claude/skills/gstack/codex/tests/codex-companion-fake.mjs`
- Modify: `.claude/skills/gstack/codex/tests/test-codex-companion-fake.sh`

- [ ] **Step 1: Extend the test with delegation + fail-loud cases**

Replace `.claude/skills/gstack/codex/tests/test-codex-companion-fake.sh` with:

```bash
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

# Case C: fail-loud mode — no $CODEX_BIN, no codex on PATH, fake emits status=1.
env -i PATH=/nonexistent HOME="$HOME" \
  node "$FAKE" task --fresh --json --prompt-file "$TMP/prompt.txt" > "$TMP/out-c.json"
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
```

- [ ] **Step 2: Run test to confirm current version fails cases B–D**

```bash
bash .claude/skills/gstack/codex/tests/test-codex-companion-fake.sh
```

Expected: FAIL on case B (current stub exits 2 with TODO message).

- [ ] **Step 3: Extend the fake**

Replace `.claude/skills/gstack/codex/tests/codex-companion-fake.mjs` with:

```javascript
#!/usr/bin/env node
// Test stand-in for codex-plugin-cc's codex-companion.mjs.
// Modes (evaluated in order):
//   1. CODEX_COMPANION_FAKE_PAYLOAD: emit that JSON file verbatim to stdout
//   2. spawn ${CODEX_BIN:-codex} with prompt, wrap stdout as plugin-shape JSON
//   3. if no codex binary resolves, emit {"status":1,...} so tests fail loud
//
// Exit code: CODEX_COMPANION_FAKE_EXIT if set, else 0 (except mode 1 override).
// Side log: CODEX_COMPANION_FAKE_LOG if set — append argv per invocation.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";

function log(line) {
  if (process.env.CODEX_COMPANION_FAKE_LOG) {
    fs.appendFileSync(process.env.CODEX_COMPANION_FAKE_LOG, `${line}\n`);
  }
}

function exitWith(code) {
  const override = process.env.CODEX_COMPANION_FAKE_EXIT;
  process.exit(override != null ? parseInt(override, 10) : code);
}

function emitJson(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

log(`argv: ${process.argv.slice(2).join(" ")}`);

// Mode 1: direct payload override
const payloadPath = process.env.CODEX_COMPANION_FAKE_PAYLOAD;
if (payloadPath && fs.existsSync(payloadPath)) {
  process.stdout.write(fs.readFileSync(payloadPath, "utf8"));
  exitWith(0);
}

// Parse --prompt-file from argv (ignore other flags).
const args = process.argv.slice(2);
let promptFile = null;
let cwd = process.cwd();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--prompt-file" && i + 1 < args.length) promptFile = args[i + 1];
  if (args[i] === "--cwd" && i + 1 < args.length) cwd = args[i + 1];
}

const prompt = promptFile && fs.existsSync(promptFile)
  ? fs.readFileSync(promptFile, "utf8")
  : "";

// Mode 2: delegate to ${CODEX_BIN:-codex}
const codexBin = process.env.CODEX_BIN || "codex";
// Pass -C <cwd> and the prompt as positional, mimicking `codex exec` shape
// so existing shell stubs that parse -C work without changes.
const child = spawnSync(codexBin, ["-C", cwd, prompt], {
  encoding: "utf8",
  // Don't inherit stderr — we'll ignore it per-test; tests assert on rawOutput.
  stdio: ["ignore", "pipe", "pipe"]
});

// Mode 3: fail-loud if codex binary couldn't be invoked
if (child.error || child.status === null) {
  emitJson({
    status: 1,
    threadId: "fake-broken",
    rawOutput: `codex-companion-fake: failed to invoke ${codexBin}: ${child.error ? child.error.message : "no exit status"}`,
    touchedFiles: [],
    reasoningSummary: []
  });
  exitWith(0);
}

// Mode 2 continued: wrap stdout as plugin JSON
const threadId = `fake-${process.pid}-${Date.now()}`;
emitJson({
  status: child.status === 0 ? 0 : 1,
  threadId,
  rawOutput: (child.stdout || "").trim(),
  touchedFiles: [],
  reasoningSummary: []
});
exitWith(0);
```

- [ ] **Step 4: Run test to verify all cases pass**

```bash
bash .claude/skills/gstack/codex/tests/test-codex-companion-fake.sh
```

Expected: `PASS: test-codex-companion-fake (payload + delegation + fail-loud)`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/tests/codex-companion-fake.mjs \
        .claude/skills/gstack/codex/tests/test-codex-companion-fake.sh
git commit -m "$(cat <<'EOF'
test: codex-companion-fake gets $CODEX_BIN delegation + fail-loud

Delegates to ${CODEX_BIN:-codex} via spawnSync; wraps stdout in
plugin-shape JSON. When no codex binary resolves, emits status:1 so
broken test harnesses surface as PLUGIN_ERROR instead of silently
passing as DONE.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Rewrite `codex-dispatch-task` end-to-end

This is the main port. One big task because the script has to be written as a whole (bash lacks clean unit boundaries). TDD via the existing `test-dispatch-task.sh` contract.

**Files:**
- Modify: `.claude/skills/gstack/codex/bin/codex-dispatch-task` (full replace)
- Modify: `.claude/skills/gstack/codex/tests/test-dispatch-task.sh` (update to new fake + new fixtures)

- [ ] **Step 1: Update `test-dispatch-task.sh` to the new contract**

Replace `.claude/skills/gstack/codex/tests/test-dispatch-task.sh` with:

```bash
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

# Case D: missing plugin — CODEX_COMPANION unset and jq lookup fails.
env -i PATH="/nonexistent" HOME="$HOME" TMPDIR="$TMP" \
  "$DISPATCH" \
    --worktree "$WT" \
    --log "$LOGDIR/d.log" \
    --prompt-file <(echo "minimal prompt") \
    --reasoning high \
    --session-file "$TMP/d.sid" \
  > "$TMP/d.out" 2> "$TMP/d.err" || true

status="$(cat "$TMP/d.out")"
[ "$status" = "PLUGIN_ERROR" ] || { echo "FAIL D: status=$status expected PLUGIN_ERROR for missing plugin"; exit 1; }
grep -q "codex-plugin-cc not installed" "$TMP/d.err" || { echo "FAIL D: stderr missing install guidance"; exit 1; }

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

echo "PASS: test-dispatch-task (all cases)"
```

- [ ] **Step 2: Run test to confirm current dispatch fails it**

```bash
bash .claude/skills/gstack/codex/tests/test-dispatch-task.sh
```

Expected: FAIL (old dispatch doesn't know about CODEX_COMPANION, --findings-out, PLUGIN_ERROR).

- [ ] **Step 3: Replace `codex-dispatch-task` with the new implementation**

Replace `.claude/skills/gstack/codex/bin/codex-dispatch-task` entirely with:

```bash
#!/usr/bin/env bash
# Single-task dispatch via codex-plugin-cc (codex-companion.mjs task).
# Replaces the previous direct `codex exec` shell-out. See:
#   docs/superpowers/specs/2026-04-22-codex-dispatch-plugin-port-design.md
#
# Status contract (stdout, exit 0):
#   DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | PLUGIN_ERROR
#
# Options:
#   --worktree <dir>        working root
#   --log <file>            pretty-printed plugin payload + reasoning + files
#   --prompt-file <file>    rendered prompt (passed to plugin via --prompt-file)
#   --reasoning <lvl>       low|medium|high|xhigh → plugin --effort
#   --session-file <file>   truncated at start; holds plugin threadId on any
#                           valid JSON response (success or failure)
#   --findings-out <file>   if set, dispatch writes synthetic findings file
#                           on BLOCKED/NEEDS_CONTEXT exit (for next attempt's
#                           render_prompt to pick up)
#   --timeout <sec>         optional, default 1800; wraps plugin invocation
set -euo pipefail

WT=""; LOG=""; PROMPT_FILE=""; REASONING="high"; SID_FILE=""; FINDINGS_OUT=""; TO=1800
while [ $# -gt 0 ]; do
  case "$1" in
    --worktree)     WT="$2"; shift 2 ;;
    --log)          LOG="$2"; shift 2 ;;
    --prompt-file)  PROMPT_FILE="$2"; shift 2 ;;
    --reasoning)    REASONING="$2"; shift 2 ;;
    --session-file) SID_FILE="$2"; shift 2 ;;
    --findings-out) FINDINGS_OUT="$2"; shift 2 ;;
    --timeout)      TO="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
: "${WT:?--worktree required}"
: "${LOG:?--log required}"
: "${PROMPT_FILE:?--prompt-file required}"
: "${SID_FILE:?--session-file required}"

mkdir -p "$(dirname "$LOG")"
: > "$SID_FILE"  # truncate first — never leak stale threadId from prior attempt

# ---- Resolve plugin path (CODEX_COMPANION env override wins; else pick
# max_by(installedAt) from installed_plugins.json; normalize singleton→array
# just in case Claude ever changes the shape). Guard every failure with
# || true to avoid set -e aborting before we emit PLUGIN_ERROR.
if [ -z "${CODEX_COMPANION:-}" ]; then
  CODEX_COMPANION="$(
    jq -r '
      (.plugins["codex@openai-codex"] | if type == "array" then . else [.] end)
      | max_by(.installedAt)
      | .installPath + "/scripts/codex-companion.mjs"
    ' "$HOME/.claude/plugins/installed_plugins.json" 2>/dev/null || true
  )"
fi

if [ -z "$CODEX_COMPANION" ] || [ ! -f "$CODEX_COMPANION" ]; then
  echo "codex-plugin-cc not installed; run /codex:setup" >&2
  echo "PLUGIN_ERROR"
  exit 0
fi

# ---- Invoke plugin task (timeout wrapper for belt-over-suspenders).
if command -v timeout >/dev/null 2>&1; then
  TO_CMD=(timeout "$TO")
elif command -v gtimeout >/dev/null 2>&1; then
  TO_CMD=(gtimeout "$TO")
else
  TO_CMD=()
fi

# Plugin resolves workspaceRoot from cwd, so cd into $WT before invoking.
tmp_stdout="$(mktemp)"
tmp_stderr="$(mktemp)"
trap 'rm -f "$tmp_stdout" "$tmp_stderr"' EXIT

set +e
( cd "$WT" && "${TO_CMD[@]+"${TO_CMD[@]}"}" node "$CODEX_COMPANION" \
    task --fresh --write --json \
    --effort "$REASONING" \
    --prompt-file "$PROMPT_FILE" ) \
  > "$tmp_stdout" 2> "$tmp_stderr"
rc=$?
set -e

# ---- Timeout or spawn failure → PLUGIN_ERROR.
if [ "$rc" -eq 124 ] || [ "$rc" -ne 0 ] && [ ! -s "$tmp_stdout" ]; then
  {
    echo "=== dispatch attempt — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    echo "PLUGIN_ERROR: plugin invocation failed (rc=$rc)"
    if [ "$rc" -eq 124 ]; then echo "dispatch timeout after $TO seconds"; fi
    echo "--- stderr ---"
    cat "$tmp_stderr"
  } >> "$LOG"
  echo "PLUGIN_ERROR"
  exit 0
fi

# ---- Parse plugin JSON. If parse fails → PLUGIN_ERROR.
if ! jq -e type "$tmp_stdout" >/dev/null 2>&1; then
  {
    echo "=== dispatch attempt — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
    echo "PLUGIN_ERROR: plugin output was not valid JSON (rc=$rc)"
    echo "--- raw stdout (first 2KB) ---"
    head -c 2048 "$tmp_stdout"
    echo
    echo "--- stderr ---"
    cat "$tmp_stderr"
  } >> "$LOG"
  echo "PLUGIN_ERROR"
  exit 0
fi

plugin_status="$(jq -r '.status // 1' "$tmp_stdout")"
thread_id="$(jq -r '.threadId // empty' "$tmp_stdout")"
raw_output="$(jq -r '.rawOutput // ""' "$tmp_stdout")"
touched_files="$(jq -r '.touchedFiles // [] | join("\n")' "$tmp_stdout")"
reasoning_trace="$(jq -r '.reasoningSummary // [] | join("\n\n")' "$tmp_stdout")"

# Always record threadId on any valid plugin JSON (success OR failure).
if [ -n "$thread_id" ] && [ "$thread_id" != "null" ]; then
  echo "$thread_id" > "$SID_FILE"
fi

# Write log entry.
{
  echo "=== dispatch attempt — $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  echo "Plugin payload:"
  jq . "$tmp_stdout" 2>/dev/null || cat "$tmp_stdout"
  echo
  echo "--- reasoning summary ---"
  if [ -n "$reasoning_trace" ]; then echo "$reasoning_trace"; else echo "(none)"; fi
  echo
  echo "--- touched files ---"
  if [ -n "$touched_files" ]; then echo "$touched_files"; else echo "(none)"; fi
  if [ -s "$tmp_stderr" ]; then
    echo
    echo "--- stderr ---"
    cat "$tmp_stderr"
  fi
} >> "$LOG"

# ---- Status mapping.
if [ "$plugin_status" != "0" ]; then
  echo "PLUGIN_ERROR"
  exit 0
fi

case "$raw_output" in
  *DONE_WITH_CONCERNS*) status="DONE_WITH_CONCERNS" ;;
  *DONE*)                status="DONE" ;;
  *NEEDS_CONTEXT*)       status="NEEDS_CONTEXT" ;;
  *BLOCKED*)             status="BLOCKED" ;;
  *)                     status="DONE_WITH_CONCERNS" ;;
esac

# ---- Findings synthesis on dispatch failure (BLOCKED or NEEDS_CONTEXT).
# render_prompt in codex-run-wave picks this up on the next attempt.
if [ -n "$FINDINGS_OUT" ] && { [ "$status" = "BLOCKED" ] || [ "$status" = "NEEDS_CONTEXT" ]; }; then
  {
    echo "Prior dispatch attempt returned $status without running the implementation to completion."
    echo
    echo "What Codex reported in its final message:"
    if [ -n "$raw_output" ]; then echo "$raw_output"; else echo "(empty)"; fi
    echo
    echo "Reasoning trace:"
    if [ -n "$reasoning_trace" ]; then echo "$reasoning_trace"; else echo "(none)"; fi
    echo
    echo "Files touched by the failed attempt (may be incomplete or half-applied):"
    if [ -n "$touched_files" ]; then echo "$touched_files"; else echo "(none)"; fi
  } > "$FINDINGS_OUT"
fi

# ---- Auto-commit codex's changes. Codex's app-server sandbox (workspace-write)
# can't write to $WT/.git/worktrees/<name>/ (git-worktree metadata lives
# outside the codex sandbox), so commits from inside the model fail
# silently. Bash runs outside the sandbox, so we commit here on its behalf
# whenever codex thinks it finished work. Skip on BLOCKED/NEEDS_CONTEXT
# (half-done work should not be squashed; the wave will retry or escalate).
if [ "$status" = "DONE" ] || [ "$status" = "DONE_WITH_CONCERNS" ]; then
  if (cd "$WT" && [ -n "$(git status --porcelain 2>/dev/null)" ]); then
    (cd "$WT" \
      && git -c user.email=codex@local -c user.name=codex add -A \
      && git -c user.email=codex@local -c user.name=codex commit -qm \
        "codex task: auto-commit of worktree changes") || true
  fi
fi

echo "$status"
exit 0
```

- [ ] **Step 4: Run test to verify the new dispatch passes**

```bash
bash .claude/skills/gstack/codex/tests/test-dispatch-task.sh
```

Expected: `PASS: test-dispatch-task (all cases)`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-dispatch-task \
        .claude/skills/gstack/codex/tests/test-dispatch-task.sh
git commit -m "$(cat <<'EOF'
codex-dispatch: port to codex-plugin-cc (codex-companion.mjs task)

Full rewrite of bin/codex-dispatch-task. Replaces direct codex exec
shell-out with plugin's task runtime. Gains:
- Structured JSON output (no JSONL scraping)
- Plugin-maintained app-server protocol
- Upstream XML-tagged prompts for gpt-5.4
- threadId for /codex:status debugging

New behaviors:
- --fresh on every call (parallel-safe; findings synthesis carries
  prior-attempt context via --findings-out for BLOCKED/NEEDS_CONTEXT)
- New PLUGIN_ERROR status for plugin-level failures
- SID_FILE truncated per call; records threadId on any valid response
- Plugin path resolved via installed_plugins.json max_by(installedAt)
  with singleton→array normalization

Test coverage: 5 cases (DONE, BLOCKED with findings, PLUGIN_ERROR on
status:1, missing-plugin, auto-commit preserved).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Apply two-line changes to `codex-run-wave`

**Files:**
- Modify: `.claude/skills/gstack/codex/bin/codex-run-wave` (add `--findings-out` flag to dispatch call, add PLUGIN_ERROR to dispatch-failure branch)

- [ ] **Step 1: Add `--findings-out` to the dispatch call**

In `.claude/skills/gstack/codex/bin/codex-run-wave`, find the block around line 423-429:

```bash
    status="$("$BIN/codex-dispatch-task" \
      --worktree "$wt" \
      --log "$LOGS/$slug.log" \
      --prompt-file "$prompt_file" \
      --reasoning "$reasoning" \
      --session-file "$sid_file" \
      --timeout "$TIMEOUT")"
```

Add `--findings-out` pointing at the per-attempt findings path (same path the gate would write; mutually exclusive branches can't collide):

```bash
    status="$("$BIN/codex-dispatch-task" \
      --worktree "$wt" \
      --log "$LOGS/$slug.log" \
      --prompt-file "$prompt_file" \
      --reasoning "$reasoning" \
      --session-file "$sid_file" \
      --findings-out "$WORK/findings.$WAVE.$num.$attempt.txt" \
      --timeout "$TIMEOUT")"
```

- [ ] **Step 2: Extend the dispatch-failure branch to recognize PLUGIN_ERROR**

Find the block around line 437:

```bash
    if [ "$status" = "BLOCKED" ] || [ "$status" = "NEEDS_CONTEXT" ]; then
      gate_status="FAIL dispatch"
    else
```

Replace with:

```bash
    if [ "$status" = "BLOCKED" ] || [ "$status" = "NEEDS_CONTEXT" ] || [ "$status" = "PLUGIN_ERROR" ]; then
      gate_status="FAIL dispatch"
    else
```

- [ ] **Step 3: Verify diff is exactly two lines changed**

```bash
git diff .claude/skills/gstack/codex/bin/codex-run-wave
```

Expected: exactly two hunks — one adding `--findings-out "$WORK/findings.$WAVE.$num.$attempt.txt" \`, and one extending the `if` condition with `|| [ "$status" = "PLUGIN_ERROR" ]`.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/gstack/codex/bin/codex-run-wave
git commit -m "$(cat <<'EOF'
codex-run-wave: recognize PLUGIN_ERROR + pass --findings-out

Two surgical changes in service of the codex-dispatch plugin port:
1. Line 428: pass --findings-out "$WORK/findings.$WAVE.$num.$attempt.txt"
   so dispatch can write synthetic findings on BLOCKED/NEEDS_CONTEXT.
   render_prompt at line 94-99 already picks up that path on the next
   attempt, so we gain prior-attempt context carry-forward without
   resume semantics — parallel-safe.
2. Line 437: extend dispatch-failure branch to treat PLUGIN_ERROR the
   same as BLOCKED/NEEDS_CONTEXT (skip gate, retry).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Migrate orchestrator-level tests to declare `CODEX_COMPANION`

Each test that exercises dispatch via the orchestrator needs to know where the fake is. The shim delegates to `$CODEX_BIN`, so existing PATH/`CODEX_BIN` stubs continue to drive side effects.

**Files:**
- Modify: `.claude/skills/gstack/codex/tests/test-e2e.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-cross-wave.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-claude-fallback.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-post-wave-recovery.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-resume-cleanup.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-resume-claude-fallback.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-only-task.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-preflight.sh`
- Modify: `.claude/skills/gstack/codex/tests/test-render-prompt-ampersand.sh`

- [ ] **Step 1: Identify the common export pattern**

For each test listed above, find the line that exports PATH or `CODEX_BIN` (typically `export PATH="$TMP/stubs:$PATH"` or `CODEX_BIN="$FAKE"`). Directly after that line, add:

```bash
export CODEX_COMPANION="$THIS_DIR/codex-companion-fake.mjs"
```

If a test uses `$(cd "$(dirname "$0")" && pwd)` to derive `$THIS_DIR`, that variable already exists. If not (e.g., a test uses a different variable name), adapt accordingly but keep the absolute path resolution.

- [ ] **Step 2: Add the export to `test-e2e.sh`**

Find the line `export PATH="$TMP/stubs:$PATH"` (around line 58). Immediately after it, insert:

```bash
export CODEX_COMPANION="$THIS_DIR/codex-companion-fake.mjs"
```

- [ ] **Step 3: Repeat for each remaining test file**

For each of the 8 other test files listed under "Files" at the top of this task, add the same `export CODEX_COMPANION=...` line directly after the test's existing `CODEX_BIN=` or `export PATH=` line. For each:

```bash
# test-cross-wave.sh
# After the existing PATH export near line 92:
export CODEX_COMPANION="$THIS_DIR/codex-companion-fake.mjs"

# test-claude-fallback.sh
# After the existing PATH/CODEX_BIN export near line 56:
export CODEX_COMPANION="$THIS_DIR/codex-companion-fake.mjs"

# test-post-wave-recovery.sh
# After the existing PATH/CODEX_BIN export:
export CODEX_COMPANION="$THIS_DIR/codex-companion-fake.mjs"

# test-resume-cleanup.sh — same
# test-resume-claude-fallback.sh — same
# test-only-task.sh — same
# test-preflight.sh — same
# test-render-prompt-ampersand.sh — same
```

- [ ] **Step 4: Run each updated test individually**

```bash
for t in test-e2e.sh test-cross-wave.sh test-claude-fallback.sh \
         test-post-wave-recovery.sh test-resume-cleanup.sh \
         test-resume-claude-fallback.sh test-only-task.sh \
         test-preflight.sh test-render-prompt-ampersand.sh; do
  echo "=== $t ==="
  bash ".claude/skills/gstack/codex/tests/$t" || echo "FAILED: $t"
done
```

Expected: all 9 tests PASS. If any fail, fix the `CODEX_COMPANION` export placement (it must be before any dispatch-invoking subprocess) and re-run.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/gstack/codex/tests/*.sh
git commit -m "$(cat <<'EOF'
tests: export CODEX_COMPANION for dispatch-exercising tests

The new codex-dispatch-task resolves codex-companion.mjs via an env
override (CODEX_COMPANION) with fallback to installed_plugins.json.
Tests point that env var at tests/codex-companion-fake.mjs. The fake
delegates to ${CODEX_BIN:-codex}, so existing PATH stubs drive side
effects unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Run the full integration test suite

**Files:**
- (None modified; validation step only.)

- [ ] **Step 1: Run the complete suite**

```bash
cd /Users/will/nanoclaw/.worktrees/feat-codex-dispatch-plugin-port
bash .claude/skills/gstack/codex/tests/run-all.sh
```

Expected: all 17 tests PASS (16 pre-existing + 1 new `test-codex-companion-fake.sh`).

- [ ] **Step 2: If any test fails, iterate**

For each failure:
1. Read the failure message.
2. Check the specific test's `$LOG` or stdout for context.
3. If the issue is in dispatch, edit `bin/codex-dispatch-task` and re-run just that test.
4. If the issue is in the fake, edit `tests/codex-companion-fake.mjs` and re-run.
5. If the issue is in the test's own setup (bad CODEX_COMPANION placement, stale fixture), fix the test.
6. Once individual test passes, re-run the full suite.

Do NOT move to the next task until all 17 tests pass. No green-by-skip.

- [ ] **Step 3: Commit any test-suite fixes separately**

If you made fixes in Step 2, commit each as a focused change:

```bash
# Example: if dispatch needed a fix
git add .claude/skills/gstack/codex/bin/codex-dispatch-task
git commit -m "fix: <specific issue>"
```

---

## Task 8: Real-world smoke test

Run `/codex implement` end-to-end against a trivial throwaway plan using the real plugin runtime (not the fake).

**Files:**
- Create (temporary): `/tmp/codex-smoke-plan.md`

- [ ] **Step 1: Write a minimal smoke plan**

```bash
cat > /tmp/codex-smoke-plan.md <<'EOF'
# Smoke: codex-dispatch plugin port

**Goal:** Verify new dispatch works against real codex-plugin-cc runtime.

**Test command:** `test -f /tmp/codex-smoke-output.txt`

## Wave 1

### Task 1: Create smoke file

**Run:** `test -f /tmp/codex-smoke-output.txt`

Create a file at `/tmp/codex-smoke-output.txt` containing the exact text `hello from codex`. Just run `echo "hello from codex" > /tmp/codex-smoke-output.txt` from the bash tool.

## Parallelization

- wave 1: [1]
EOF
```

- [ ] **Step 2: Ensure clean state**

```bash
rm -f /tmp/codex-smoke-output.txt
cd /Users/will/nanoclaw/.worktrees/feat-codex-dispatch-plugin-port
```

- [ ] **Step 3: Run the orchestrator against the smoke plan**

This step invokes the real plugin runtime (no `CODEX_COMPANION` override). Use the dispatch's real path:

```bash
bash .claude/skills/gstack/codex/bin/codex-implement /tmp/codex-smoke-plan.md 2>&1 | tee /tmp/codex-smoke.log
```

- [ ] **Step 4: Verify outcomes**

```bash
test -f /tmp/codex-smoke-output.txt && cat /tmp/codex-smoke-output.txt
grep "hello from codex" /tmp/codex-smoke-output.txt
```

Expected: file exists, contains `hello from codex`. Also check state.json if one was written — the attempt should record a real plugin `threadId` (not "fake-*"):

```bash
# Find state.json (path depends on how codex-implement lays out $WORK)
find ~/.gstack/codex-work -name 'state.json' -newer /tmp/codex-smoke-plan.md | head -3 \
  | xargs -I {} jq '.attempts // [] | .[] | .session_id' {}
```

- [ ] **Step 5: Inspect the dispatch log**

```bash
find ~/.gstack/codex-work -name '*.log' -newer /tmp/codex-smoke-plan.md | head -1 | xargs cat
```

Expected: log shows `=== dispatch attempt —`, plugin JSON payload, reasoning summary, touched files section. No JSONL event spam.

- [ ] **Step 6: Clean up**

```bash
rm -f /tmp/codex-smoke-output.txt /tmp/codex-smoke-plan.md /tmp/codex-smoke.log
```

No commit — this was validation only. If the smoke test revealed a real bug, go back to Task 4 or Task 5 to fix it and re-run Task 7 + Task 8.

---

## Task 9: Codex plugin review of the branch diff

First dogfooding of the plugin's `/codex:review` against our own code. Validates the plugin end-to-end.

**Files:**
- (None modified; review step only.)

- [ ] **Step 1: Push the branch to origin so review sees committed state**

```bash
cd /Users/will/nanoclaw/.worktrees/feat-codex-dispatch-plugin-port
git push -u origin feat/codex-dispatch-plugin-port
```

- [ ] **Step 2: Run the adversarial review**

Tell the user to run this slash command (it's Claude Code harness, not bash-invocable):

```
/codex:adversarial-review --wait --base origin/main
```

Wait for completion. The review output will print into the conversation.

- [ ] **Step 3: Evaluate findings**

For each P1 finding: verify against source, then either fix on this branch (add commit) or push back with evidence. For each P2: decide before-ship vs after-ship.

No P1 findings → GATE PASS → proceed to Task 10.

If any P1 findings, fix them (each as its own commit), re-run the review, iterate until PASS.

- [ ] **Step 4: Commit any review-driven fixes**

```bash
# After each fix:
git add <files>
git commit -m "codex-review: <finding title>"
```

---

## Task 10: Merge, update memory, close SYNC

**Files:**
- Modify: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_codex_plugin_install.md`
- Modify: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/SYNC.md`

- [ ] **Step 1: Merge to main**

```bash
cd /Users/will/nanoclaw
git fetch origin
git checkout main 2>/dev/null || git switch main
# Fast-forward if clean, otherwise user handles the merge.
git merge --ff-only origin/feat/codex-dispatch-plugin-port || echo "non-FF; ask user"
git push origin main
```

- [ ] **Step 2: Update `project_codex_plugin_install.md`**

Read the current file:

```bash
cat /Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_codex_plugin_install.md
```

Find the `**Deferred Phase 3:**` block and replace it with:

```markdown
**Phase 3 shipped 2026-04-22:** `/codex implement` dispatch now uses plugin runtime. Port landed as commit `<SHA>` on main. Code paths:
- `bin/codex-dispatch-task` — calls `codex-companion.mjs task` (no more `codex exec` shell-out)
- `tests/codex-companion-fake.mjs` — test shim delegating to `${CODEX_BIN:-codex}`
- `bin/codex-run-wave` — two surgical additions (lines 428, 437) for `--findings-out` + `PLUGIN_ERROR`
- New `PLUGIN_ERROR` status code for plugin-level failures
- state.json `session_id` field now stores plugin `threadId` (use `/codex:status <threadId>` to inspect, not `codex exec resume`)
```

- [ ] **Step 3: Close out SYNC.md Yellow entry**

Edit `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/SYNC.md`. Find the Session Yellow entry's "Phase 3 (UNBLOCKED, not yet started):" block and replace with:

```markdown
**Phase 3 shipped 2026-04-22:** codex-dispatch plugin port merged as `<SHA>` on main. Spec doc + impl plan at `docs/superpowers/plans/2026-04-22-codex-dispatch-plugin-port.md`. Survived 3 rounds of adversarial codex review on the spec (threads 019db442, 019db450, 019db457) and one branch-diff review (`/codex:adversarial-review`). All 17 integration tests pass. Real-world smoke green. Will can now invoke `/codex implement` against a plan and the dispatch will run through the plugin runtime end-to-end.
```

- [ ] **Step 4: Update Yellow entry's status line**

Change the title from `✅ PHASE 1+2 SHIPPED` to `✅ PHASES 1-3 SHIPPED`.

- [ ] **Step 5: Clean up the worktree**

```bash
cd /Users/will/nanoclaw
git worktree remove .worktrees/feat-codex-dispatch-plugin-port
```

- [ ] **Step 6: Verify end state**

```bash
git log --oneline -5
git worktree list
# Should show primary at main + feat-codex-implement (not our port anymore)
```

Expected: main has the port commits; our feature worktree is gone; `/codex implement` is ready for real Dodami feature work against Codex Pro.

---

## Post-Implementation Notes

- **Reversibility:** if the port causes unexpected issues in real Dodami work, revert the merge and re-enable the old dispatch via `git revert <merge-sha>`. `codex-fake` is still present for non-plugin test paths.
- **First real use:** first `/codex implement` run against a Dodami plan after merge is the ultimate validation. Watch for:
  - state.json `session_id` field containing real threadIds (not fake-*)
  - Dispatch `$LOG` containing human-readable reasoning, not JSONL
  - PLUGIN_ERROR appearing in state.json `result` field only on plugin-level failures (never on legitimate codex BLOCKED/NEEDS_CONTEXT)
