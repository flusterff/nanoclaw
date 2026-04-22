# /codex implement — Dispatch port to codex-plugin-cc runtime

**Status:** Design rev 4, final. Rev 3 re-review (thread `019db457-5686-78e1-9f70-b226c90f3a31`) confirmed all rev-2 findings RESOLVED and flagged 1 NEW P2 (fake's fallback-on-spawn-failure emitted trivial success instead of surfacing broken harness). Rev 4 inverts that fallback to `status: 1`. Skipping further review rounds — remaining diffs are mechanical. Ready for implementation plan via `writing-plans` skill.
**Author:** Session Yellow (Claude Opus 4.7)
**Brainstorm transcript:** conversation on 2026-04-22 that produced this spec.

## Goal

Port `/codex implement`'s task-dispatch layer from direct `codex exec` shell-out to OpenAI's `codex-plugin-cc` runtime (`codex-companion.mjs task`). Narrow-surface change (115 LOC rewrite) that gains upstream-maintained plumbing, XML-tagged prompts tuned for gpt-5.4, structured JSON output, and job-tracking persistence — without touching the 2,236 LOC of wave orchestration that survived 45 rounds of hardening.

End goal: `/codex implement` and all codex-related surfaces just work for day-to-day Dodami feature implementation against a Codex Pro plan.

## Context

- `codex-plugin-cc` v1.0.4 installed 2026-04-22 at `~/.claude/plugins/cache/openai-codex/codex/1.0.4/` (SYNC entry + `project_codex_plugin_install.md`).
- Stop review gate enabled in both Dodami repos. Gate disabled in nanoclaw to avoid colliding with /codex implement development.
- Session Blue's `fix/codex-implement-4-fixes` merged as `d497984` on origin/main. /codex implement orchestrator is now stable baseline for the port.
- 17 integration tests pass on origin/main.

## Scope

### In scope — fully rewritten

`.claude/skills/gstack/codex/bin/codex-dispatch-task` (115 LOC). Every line replaced.

### In scope — small additions to `codex-run-wave`

Two one-line additions to `.claude/skills/gstack/codex/bin/codex-run-wave`:

1. **Line 437:** add `|| [ "$status" = "PLUGIN_ERROR" ]` to the dispatch-failure branch so new PLUGIN_ERROR status code is recognized.
2. **Line 428** (the dispatch call): add `--findings-out "$WORK/findings.$WAVE.$num.$attempt.txt"` flag. This lets dispatch write a synthesized findings file on BLOCKED/NEEDS_CONTEXT exit, so the next attempt's `render_prompt` call has prior-attempt context to prepend. (See "Findings synthesis" section below.)

### In scope — new test infrastructure

- `.claude/skills/gstack/codex/tests/codex-companion-fake.mjs` (new file, ~60 LOC estimated) — stand-in for real plugin, emits plugin-shape JSON. Includes backward-compat shim that accepts legacy `CODEX_FAKE_RESPONSES` JSONL fixtures.
- Env-var swaps in ~10 test files: `CODEX_BIN=./codex-fake` → `CODEX_COMPANION=./codex-companion-fake.mjs`. One-line changes each.

### Out of scope — explicitly untouched

- `codex-implement` (348 LOC)
- `codex-run-wave` (577 LOC) — except the one-line PLUGIN_ERROR addition above
- `codex-merge-wave` (528 LOC)
- `codex-gate` (153 LOC) — still calls `codex review` directly
- `codex-gate-review` (55 LOC) — still calls `codex review` directly
- `codex-parse-plan` (279 LOC)
- `codex-state` (207 LOC) — state.json schema unchanged
- `codex-worktree` (49 LOC)
- Prompt templates (`codex-implementer-prompt.md`, `codex-fallback-prompt.md`, `spec-reviewer-prompt.md`)
- Marker file system
- Canary-revert logic
- Rollback logic
- All 45 rounds of wave-orchestration hardening

### Out of scope — not ported

- `bin/codex-run.sh` pattern (the `===DONE===` sentinel wrapper used in Dodami repos). That was never in nanoclaw; no port needed.
- Gate review's use of `codex review` subcommand. Plugin's `/codex:review` is a Claude-invoked slash command, not a subprocess. Different shape; staying on direct CLI for gate.

## Interface contract

`codex-dispatch-task` must preserve its CLI flags and stdout contract for backward compatibility with its only caller (`codex-run-wave:423-429`):

| Flag in | Old behavior | New behavior |
|---|---|---|
| `--worktree <dir>` | `codex -C <dir>` | `cd <dir>` before invoking node (plugin resolves workspaceRoot from cwd) |
| `--log <file>` | JSONL stream dump | Plugin JSON payload + human-readable reasoningSummary + touchedFiles + stderr tail |
| `--prompt-file <file>` | Cat'd into `$prompt` arg | Passed directly to plugin via `--prompt-file <file>` (plugin reads it) |
| `--reasoning <lvl>` | `-c model_reasoning_effort=$lvl` | `--effort $lvl` |
| `--session-file <file>` | Read/write codex session id | **Truncate at start of every call**, then write plugin's `threadId` whenever valid plugin JSON contains one (regardless of semantic status). File retains a real debugging ID for every attempt — including failed ones. `state.json` records the correct per-attempt threadId. |
| `--findings-out <file>` | (new flag) not used | On exit with `BLOCKED` or `NEEDS_CONTEXT`, dispatch writes a synthesized findings file to this path (see below). No-op for other exit statuses. |
| `--timeout <sec>` | `timeout N codex ...` wrapper | Same `timeout N node ...` wrapper (belt over plugin's own broker lifecycle) |

**stdout contract:** single status word, one of:
- `DONE` — codex completed the task
- `DONE_WITH_CONCERNS` — codex completed but flagged concerns
- `NEEDS_CONTEXT` — codex needs more info to proceed
- `BLOCKED` — codex said it couldn't do the task
- `PLUGIN_ERROR` — **new in this port** — plugin runtime failed (not-installed / crashed / timed out / plugin-returned-status=1)

Exit code 0 in all cases. Caller reads stdout for the status word.

### Flag mappings to plugin's task command

| Old `codex exec` flag | New `codex-companion.mjs task` flag |
|---|---|
| `exec` | `task` |
| `-s workspace-write` | `--write` |
| `-C $WT` | resolved via `cd $WT` before invoking node |
| `-c model_reasoning_effort="$REASONING"` | `--effort $REASONING` |
| `--enable web_search_cached` | **DROPPED** — plugin does not expose codex `--enable` passthrough. See risks. |
| `--json` | `--json` |
| `exec resume <sid>` | **Never used** — `--fresh` on every call (parallel-safe) |
| prompt as positional argv | `--prompt-file <file>` (prompt never crosses argv) |

## JSON parsing and status mapping

Plugin's `--json` mode emits a JSON payload to stdout with this shape (confirmed via source reading of `codex-companion.mjs:494-516` and `lib/codex.mjs:660-662`):

```json
{
  "status": 0,
  "threadId": "019db3a6-d2ea-7d91-b634-7eb85a49060e",
  "rawOutput": "...final assistant text including possibly DONE/BLOCKED...",
  "touchedFiles": ["path/a.py", "path/b.py"],
  "reasoningSummary": ["step 1 reasoning...", "step 2 reasoning...", "..."]
}
```

`status` is a **number**: `0` = turn completed, `1` = turn failed (any non-completed turn — does not distinguish crash from user-cancellation; see deferred limitation below).

`reasoningSummary` is a **`string[]`** (confirmed at `lib/codex.mjs:29` JSDoc and passed through unchanged at `lib/codex.mjs:1019-1025` and `codex-companion.mjs:508-513`). Dispatch flattens the array with `\n\n` when writing to `$LOG`.

### Two-stage status mapping

**Stage 1 (plugin-level):**

- `status === 1` → dispatch outputs `PLUGIN_ERROR`
- node script crashed (non-zero exit before valid JSON) → `PLUGIN_ERROR`
- shell `timeout` fired → `PLUGIN_ERROR`
- `installed_plugins.json` missing `codex@openai-codex` entry → `PLUGIN_ERROR` with specific stderr

**Stage 2 (semantic — only if stage 1 is OK):**

- Parse `rawOutput` for the existing status markers using the current `case` logic (lines 83-97):
  - `*DONE_WITH_CONCERNS*` → `DONE_WITH_CONCERNS`
  - `*DONE*` → `DONE`
  - `*NEEDS_CONTEXT*` → `NEEDS_CONTEXT`
  - `*BLOCKED*` → `BLOCKED`
  - empty `rawOutput` or no match → `DONE_WITH_CONCERNS` (matches current fallback)

No changes to the orchestrator's state machine beyond recognizing `PLUGIN_ERROR`.

### Plugin path resolution

Resolve `codex-companion.mjs` absolute path at runtime. The dispatch runs under `set -euo pipefail` (line 14 of current `codex-dispatch-task`, preserved in port), so a failing command substitution would abort the whole script before we can emit a meaningful `PLUGIN_ERROR`. Guard explicitly:

```bash
if [ -z "${CODEX_COMPANION:-}" ]; then
  CODEX_COMPANION="$(
    jq -r '
      (.plugins["codex@openai-codex"] | if type == "array" then . else [.] end)
      | max_by(.installedAt)
      | .installPath + "/scripts/codex-companion.mjs"
    ' ~/.claude/plugins/installed_plugins.json 2>/dev/null || true
  )"
fi

if [ -z "$CODEX_COMPANION" ] || [ ! -f "$CODEX_COMPANION" ]; then
  echo "codex-plugin-cc not installed; run /codex:setup" >&2
  echo "PLUGIN_ERROR"
  exit 0
fi
```

Design details:

- `CODEX_COMPANION` env override takes precedence (used by tests to inject the fake).
- `jq` is already a dispatch dependency.
- **`|| true` on the command substitution** keeps `set -e` from aborting the script when jq fails (missing entry, malformed JSON, missing file). Empty-string result is then caught by the explicit guard below.
- **Normalize-to-array prelude (`if type == "array" then . else [.] end`)** survives the low-probability case where Claude Code's format ever stores the entry as a singleton object instead of a list. `max_by` on an array always works; on a non-array it throws.
- **`max_by(.installedAt)`** picks the most recent install when multiple versions coexist.
- On empty result or missing file, dispatch emits `PLUGIN_ERROR` with actionable stderr, then `exit 0` (preserves the "status keyword on stdout, exit 0" contract for the caller).

### Session file

Dispatch always truncates `$SID_FILE` at the start, then writes plugin's `threadId` whenever valid plugin JSON contains one — regardless of `status` value:

```bash
: > "$SID_FILE"   # truncate first so stale IDs from prior attempts never leak forward

# after parsing plugin JSON:
if [ -n "$thread_id" ] && [ "$thread_id" != "null" ]; then
  echo "$thread_id" > "$SID_FILE"
fi
```

Why truncate-then-conditionally-write:
- If this attempt produces a valid thread (success or failure), state.json records *this* attempt's threadId.
- If this attempt produces no JSON at all (timeout, crash before turn start), state.json records an empty session-id for this attempt — accurate, not a stale leak from attempt N-1.

`codex-run-wave:434` continues to record `--session-id "$(cat "$sid_file" 2>/dev/null || echo '')"` unchanged. Downstream debugging (`/codex:status <threadId>`) gets a real ID for every attempt that talked to the plugin, including failed ones.

### Findings synthesis on dispatch failure

**Problem the old dispatch didn't have:** under `codex exec resume <sid>`, the retry resumed codex's in-session memory — codex knew what it had tried last attempt. Under `--fresh`, codex has nothing unless the orchestrator tells it.

`codex-run-wave:94-99` (`render_prompt`) only prepends a "PRIOR ATTEMPT FAILED BECAUSE:" section when `$findings` points at a readable file. `$findings` is populated at line 455 only *after* the gate runs. The BLOCKED/NEEDS_CONTEXT branch at line 437 skips the gate — so `$findings` is empty and the next attempt's prompt has no delta. Codex re-runs the same prompt and can trivially repeat the same failure.

**Fix (keeps parallel-safe `--fresh`):** dispatch writes a synthesized findings file at `$FINDINGS_OUT` (new flag) when exiting BLOCKED or NEEDS_CONTEXT. The content is generated from the plugin JSON, no resume needed. The orchestrator passes the same path the gate would write (`$WORK/findings.$WAVE.$num.$attempt.txt`) — paths don't collide because they write in mutually exclusive branches.

**Synthesized findings file format:**

```
Prior dispatch attempt returned <STATUS> without running the implementation to completion.

What Codex reported in its final message:
<rawOutput, as-is>

Reasoning trace:
<reasoningSummary[] joined with \n\n>

Files touched by the failed attempt (may be incomplete or half-applied):
<one path per line, or "(none)">
```

`render_prompt` at line 94-99 picks this up on the next attempt via the existing `$findings` mechanism. No changes to `render_prompt` itself.

**`--findings-out` is optional.** If not passed, dispatch skips the write (backward-compat with any future direct caller).

**Gate branch unchanged:** when dispatch returns DONE/DONE_WITH_CONCERNS, the gate runs and writes its own findings. The new file only appears on dispatch-level failure.

### Log format

`$LOG` receives (one per dispatch invocation, appended if multi-attempt):

```
=== dispatch attempt — <timestamp> ===
<full plugin JSON payload, pretty-printed>

--- reasoning summary ---
<plugin reasoningSummary[] items joined with blank lines>

--- touched files ---
<one path per line, or "(none)">

--- stderr (only if non-empty) ---
<plugin stderr tail>
```

Human-readable beats the current JSONL dump for 3am forensics. `reasoningSummary` flattening: since plugin returns a `string[]`, join each element with `\n\n` when emitting this block.

## Error handling

| Scenario | Dispatch output | `$LOG` contents |
|---|---|---|
| Plugin not installed | `PLUGIN_ERROR` | "codex-plugin-cc not installed; run /codex:setup" |
| Node spawn failure | `PLUGIN_ERROR` | node stderr |
| Invalid JSON from plugin (unexpected output) | `PLUGIN_ERROR` | raw output + parse error |
| Shell `timeout` fires (1800s default) | `PLUGIN_ERROR` | "dispatch timeout after $TO seconds" |
| Plugin `status === 1` | `PLUGIN_ERROR` | full payload including reasoningSummary |
| Plugin `status === 0`, rawOutput empty | `DONE_WITH_CONCERNS` | full payload |
| Plugin `status === 0`, rawOutput has `BLOCKED` marker | `BLOCKED` | full payload |
| Plugin `status === 0`, rawOutput has `DONE` marker | `DONE` | full payload |
| Auto-commit fails (no changes / git lock / etc.) | (continue, current status unchanged) | — (silent `\|\| true` preserved from line 110) |

The auto-commit block (lines 99-112 of current dispatch) stays verbatim — codex sandbox still can't write to `.git/worktrees/`, bash still needs to commit on codex's behalf.

## Testing strategy

### New fake: `tests/codex-companion-fake.mjs` — subprocess shim over `$CODEX_BIN`

**Problem the first draft missed:** the existing integration tests (`test-e2e.sh:23-60`, `test-cross-wave.sh`, others) don't just test status-code handling. They install an inline `codex` stub on PATH that is **prompt-aware and side-effectful** — it parses the prompt for markers like `Create: \`a.txt\``, creates those files in the worktree, and commits them. The gate check downstream then verifies those files exist. A fake that only emits JSON payload text can't drive these tests; they'd fail (files not created) or silently pass (nothing to check).

**Fix:** `codex-companion-fake.mjs` is a **thin shim** that delegates to `$CODEX_BIN` (the existing side-effectful shell stub that tests already provide) as a subprocess, then wraps its stdout in plugin-shape JSON. All existing test stubbing patterns keep working unchanged.

**Fake behavior:**

1. If `CODEX_COMPANION_FAKE_PAYLOAD` is set (direct override for new dispatch-specific tests) → read that file, emit as-is to stdout. Exit 0 unless `CODEX_COMPANION_FAKE_EXIT` overrides.
2. Else: invoke **`${CODEX_BIN:-codex}`** as a subprocess (same default as the current `codex-dispatch-task:16`, so tests that stub `codex` via PATH only — without setting `CODEX_BIN` — continue to work). Pass through `-C <cwd>` and the prompt text read from `--prompt-file`. Capture stdout. Wrap as:
   ```json
   {
     "status": <0 if subprocess exit 0, else 1>,
     "threadId": "fake-<pid>-<epoch>",
     "rawOutput": "<captured stdout>",
     "touchedFiles": [],
     "reasoningSummary": []
   }
   ```
3. If the resolved codex binary (`$CODEX_BIN` or `codex` on PATH) cannot be invoked → emit **plugin-failure** JSON so dispatch surfaces the broken harness as `PLUGIN_ERROR`: `{"status": 1, "rawOutput": "codex-companion-fake: neither $CODEX_BIN nor codex on PATH resolves", "threadId": "fake-broken", "touchedFiles": [], "reasoningSummary": []}`. Exit node with code 0 (the plugin shape carries the failure signal via `status: 1`, not the process exit code).

**Why `status: 1` instead of trivial success:** if a test forgets to set up `$CODEX_BIN` or fails to install a PATH stub, we want the test to fail loudly. Returning a trivial `DONE` would silently mask a broken harness as a passing test — false green is worse than false red.

**Why `${CODEX_BIN:-codex}` and not just `$CODEX_BIN`:**

Integration tests (`test-e2e.sh:27-57`, `test-cross-wave.sh:60-92`, `test-claude-fallback.sh:50-56`) currently stub `codex` by writing an inline binary to `$TMP/stubs/codex` and prepending that dir to PATH. **They do not export `CODEX_BIN`.** The current dispatch uses `CODEX="${CODEX_BIN:-codex}"` at line 16 precisely so PATH-based stubbing works out of the box. The shim replicates this resolution — so existing test stubs continue to be invoked as-is.

**Why the shim design:**
- Existing test stubs (test-e2e's inline `codex` binary, `codex-fake` for scripted responses) remain the side-effect engine. Tests don't need to learn a second mocking pattern.
- The shim is ~40 LOC: parse args, read prompt-file, spawn `${CODEX_BIN:-codex}`, capture stdout, emit JSON. No prompt-awareness inside the fake itself.
- Forced-status tests (e.g., `test-claude-fallback.sh` needs BLOCKED) continue using `CODEX_FAKE_RESPONSES` or `CODEX_FAKE_EXIT_FILE` against `codex-fake` — the shim sees stdout "BLOCKED", wraps it as `{status: 0, rawOutput: "BLOCKED"}`, and the new dispatch's regex parser correctly returns `BLOCKED`.

**Test migration:**

Every test that today sets `CODEX_BIN=<stub>` and exports PATH also needs to export `CODEX_COMPANION=<path-to-codex-companion-fake.mjs>`. Mechanically a two-line change per test (one-line per-test if we add an `export CODEX_COMPANION="..."` into a common test helper that existing tests already source, if one exists). Per-test additions:

```bash
export CODEX_COMPANION="$THIS_DIR/codex-companion-fake.mjs"
```

The shim reads `$CODEX_BIN` at invocation time, so the test's existing `CODEX_BIN=...` / PATH stubbing keeps working.

### Test file updates

**Tests that directly exercise dispatch** (env-var swap + possibly fixture format tweak):

- `test-dispatch-task.sh` — direct test, needs new fake + potentially new JSON fixture
- `test-render-prompt-ampersand.sh` — exercises prompt rendering through dispatch

**Tests that exercise dispatch via orchestrator** (env-var swap only, shim handles fixture):

- `test-e2e.sh`
- `test-claude-fallback.sh`
- `test-cross-wave.sh`
- `test-post-wave-recovery.sh`
- `test-resume-cleanup.sh`
- `test-resume-claude-fallback.sh`
- `test-only-task.sh`
- `test-preflight.sh`

**Tests unchanged** (don't exercise dispatch):

- `test-codex-fake.sh` — tests the legacy codex-fake itself; still valid since codex-fake still exists for other callers (gate-review)
- `test-gate.sh`, `test-gate-review.sh` — test `codex-gate` / `codex-gate-review` which still use `codex review` directly
- `test-merge-wave.sh` — tests `codex-merge-wave`, no dispatch calls
- `test-parse-plan.sh` — tests plan parser, no dispatch calls

### Gate to merge

All 17 tests pass on the new dispatch. Plus:

1. Real-world smoke on a tiny throwaway `/codex implement` plan (1 task, trivial output — e.g., "create TEST.md with content 'hello'"). Manual eyeball of state.json + log contents for correctness.
2. `/codex:review --wait` against the branch diff. No P1 findings.

## Rollout plan

1. **Create branch** `feat/codex-dispatch-plugin-port` off `origin/main` in a dedicated worktree to avoid colliding with Yellow's uncommitted changes in the primary worktree.
2. **Commit this spec doc** to the new branch.
3. **Write implementation plan** via the `writing-plans` skill → `docs/superpowers/plans/2026-04-22-codex-dispatch-plugin-port.md`. Commit.
4. **Implement:**
   - Option B for the dispatch rewrite: dogfood `/codex:rescue` to write the new `codex-dispatch-task` and the new `codex-companion-fake.mjs`. `/codex:rescue` calls the plugin directly via its own subagent path — it does not go through `/codex implement`, so the branch's half-written dispatch can't break it.
   - Option A (direct Claude execution) for the plumbing: env-var swaps in tests, line-437 addition to `codex-run-wave`.
5. **Test loop:**
   - `bash .claude/skills/gstack/codex/tests/run-all.sh` — iterate until green.
   - If flaky, extract the failing case into a minimal repro, fix, re-run the full suite.
6. **Real-world smoke:** throwaway plan.
7. **Plugin review:** `/codex:review --wait` against the branch. First dogfooding of the plugin's review on our own code. Iterate until no P1s.
8. **Merge to main**, push to origin.
9. **Update `project_codex_plugin_install.md`** — add "Phase 3 shipped" note with merged commit SHA.
10. **Update SYNC.md** Yellow entry — Phase 3 done.

### Execution pacing

This plan is ~1 full session's work (2-3 hours). Estimate breakdown:

- Spec + plan authoring: 45 min
- Dispatch rewrite (via `/codex:rescue` or direct): 30 min
- Fake + test env swaps: 45 min
- Test loop: 30 min (assumes minor iteration; could be longer if plugin surprises us)
- Real-world smoke: 10 min
- Plugin review round: 30 min
- Merge + docs: 10 min

Total: 3.5 hours wall-clock, could compress with parallel agents on independent sub-tasks.

## Risks and known unknowns

### R1 — Loss of `web_search_cached`

Plugin's `task` command doesn't expose the codex `--enable` feature passthrough. Codex won't do mid-reasoning web searches during dispatch.

**Impact:** Low for Dodami tasks (95% work against local code). High only for "integrate with new vendor SDK" tasks.

**Mitigation:** For vendor-integration tasks, include relevant docs in the prompt text manually. If this becomes a pattern, file an upstream plugin issue asking for `--codex-arg` passthrough.

### R2 — Plugin's `task` command is newer than `codex exec`

45 rounds of hardening tuned behavior around `codex exec` quirks. Plugin's `task` runs through codex's app-server protocol — different edge cases.

**Impact:** We may hit new bugs the current dispatch doesn't.

**Mitigation:** The 17 existing integration tests will catch regressions that affect orchestrator contract. Real-world smoke catches integration-level issues. Plugin-level bugs get filed upstream.

### R3 — `codex-run-wave:434` reads `$SID_FILE` as a codex session ID

Dispatch now writes plugin's `threadId` to this file instead of codex session id. Anyone who uses state.json's `session-id` field for `codex exec resume <sid>` outside the orchestrator will find it doesn't work (thread IDs aren't codex session IDs).

**Impact:** Breaks one manual debugging workflow: `codex exec resume $(jq -r '...session_id...' state.json)`.

**Mitigation:** The replacement workflow is `/codex:status <threadId>` / `/codex:result <threadId>` (plugin's own commands). Document this in the rollout step 9 memory update.

### R4 — Circular dependency during implementation

`/codex implement` depends on `codex-dispatch-task`. While we're rewriting dispatch, `/codex implement` can't be trusted on the branch.

**Impact:** We can't use `/codex implement` to implement this plan on its own branch. Must use `/codex:rescue` or direct Claude execution.

**Mitigation:** Acknowledged in rollout plan step 4. Main branch's dispatch keeps working; branch's is under surgery.

### R5 — Test fake delegates to `$CODEX_BIN`; only one "real plugin" test gate left

Existing test stubs drive side effects; the shim wraps their output in plugin JSON. The shim never exercises real plugin runtime behavior (JSON emission, threading, app-server protocol).

**Impact:** Tests stay green even if real plugin behaves differently from what the shim produces.

**Mitigation:** Step 6 real-world smoke against real plugin runtime is the gate that catches shim/reality divergence. Step 7 plugin review catches logic issues. If smoke reveals a pattern, we add a dedicated real-plugin integration test.

### R6 — Resolved limitations accepted for v1

- **`status === 1` collapses interrupted vs crashed vs turn-failed into one `PLUGIN_ERROR`.** The orchestrator treats all dispatch-failures identically (skip gate, retry with findings), so the distinction isn't actionable in v1. Sub-categories can come later if real failure patterns emerge from state.json forensics. Documented so it's not accidentally forgotten.

## Open questions

None remaining. All design decisions locked after rev 2:

- Scope: narrow-surface full-replace of dispatch + two one-line additions to `codex-run-wave` (D from brainstorm, expanded per P1 findings)
- Session semantics: `--fresh` every call, with findings synthesized into a file on dispatch failure so the next attempt has real prior-attempt context
- `--session-file` handling: truncate at start of every call, write threadId whenever valid plugin JSON contains one (not just on semantic success)
- `--enable web_search_cached`: dropped, acceptable loss
- `PLUGIN_ERROR`: single status code, accepted v1 limitation that it collapses interrupted/crashed/turn-failed
- Plugin path resolution: parse `installed_plugins.json` picking `max_by(.installedAt)` (multi-version safe)
- `reasoningSummary`: treated as `string[]`, flattened with `\n\n` in `$LOG`
- Test fake: `codex-companion-fake.mjs` delegates to `$CODEX_BIN` subprocess and wraps its output in plugin JSON (preserves all existing side-effectful test stubs)
- Findings synthesis on dispatch failure: dispatch writes to `--findings-out <path>` when exiting BLOCKED or NEEDS_CONTEXT; `codex-run-wave` passes the same path the gate would write (`$WORK/findings.$WAVE.$num.$attempt.txt`)
- Execution: branch `feat/codex-dispatch-plugin-port` in dedicated worktree, `/codex:rescue` for dispatch rewrite, direct Claude for plumbing

## Deliverables

1. Rewritten `codex-dispatch-task` (~120 LOC estimated in new form, up from 115 due to findings-out logic)
2. New `tests/codex-companion-fake.mjs` (~40 LOC estimated — thin subprocess shim)
3. Two one-line additions to `codex-run-wave`:
   - Line 428: add `--findings-out "$WORK/findings.$WAVE.$num.$attempt.txt"` to the dispatch call
   - Line 437: add `|| [ "$status" = "PLUGIN_ERROR" ]` to the dispatch-failure branch
4. `export CODEX_COMPANION=...` additions to ~10 test files alongside existing `$CODEX_BIN` / PATH setup
5. Spec doc rev 2 (this file)
6. Implementation plan doc (next step, via writing-plans skill)
7. Updated `project_codex_plugin_install.md` memory noting Phase 3 shipped

## Changelog

- **rev 1** (2026-04-22, initial) — brainstorm output. GATE FAILED adversarial review.
- **rev 2** (2026-04-22) — addressed all 4 codex P1/P2 findings + 2 inference mitigations: findings synthesis for BLOCKED/NEEDS_CONTEXT retry, fake-as-subprocess-shim, reasoningSummary-as-array, sid_file truncate-then-write, plugin path via max_by(installedAt), status=1 collapse documented as accepted v1 limitation.
- **rev 3** (2026-04-22) — addresses rev-2 re-review findings (thread `019db450-9f75-70d3-9a0a-146ebd384432`): (1) shim now delegates to `${CODEX_BIN:-codex}` so PATH-based test stubs work without explicit `CODEX_BIN` export; (2) plugin path resolution now wraps jq in an explicit `if`/guard pattern with `|| true` fallback and explicit `PLUGIN_ERROR` exit, avoiding `set -e` abort on missing plugin; (3) jq expression prefixes `if type == "array" then . else [.] end` so the resolver survives hypothetical singleton-object shape drift in `installed_plugins.json`.
- **rev 4** (2026-04-22, this file, final) — addresses rev-3 re-review P2 (thread `019db457-5686-78e1-9f70-b226c90f3a31`): fake's fallback when no codex binary resolves now emits `{"status": 1, ...}` (PLUGIN_ERROR) instead of trivial-success `{"status": 0, "rawOutput": "DONE"}`. Prevents broken test harness from masquerading as a passing run. Minor inference about `null`/missing-entry jq shape accepted — defense-in-depth guard (`[ ! -f ]`) catches it.
