# /codex implement orchestrator — Resume Brief

**Branch:** `feat/codex-implement`
**Worktree:** `/Users/will/nanoclaw/.worktrees/feat-codex-implement`
**Plan:** `docs/superpowers/plans/2026-04-15-codex-implement-orchestrator.md`
**Spec:** `docs/superpowers/specs/2026-04-15-codex-implement-orchestrator-design.md`

## Status: **COMPLETE** — T1–T14 committed, 11/11 tests pass.

| Task | Commit   | What |
|------|----------|------|
| T1   | c256e28  | Scaffolding + fake codex shim |
| T1 fix | 162bcce | Harden codex-fake exit parser + CODEX_FAKE_LOG test |
| T2   | dfaa73d  | Plan parser (bash+python, wave DAG, 5 validation checks) |
| T3   | 78994bc  | State library (flock + atomic writes) |
| T3 fix | 1caf9cd | Stale-lock recovery + tmpfile cleanup |
| T4   | 12a6227  | Worktree setup/teardown helpers |
| T5   | b76d8f7  | Codex dispatch wrapper + prompt template |
| T5 fix | 12726d8 | set-u unbound variable on empty TO_CMD |
| T5 fix | f3b0b11 | jq+pipefail on non-JSON stdout (test stubs) |
| T6   | 784030f  | Stage-2 codex review gate wrapper |
| T7   | d17082b  | Prompt templates + marker-protocol doc |
| T8   | 796f378  | 3-stage gate (codex-gate) |
| T9   | 9a7d8bc  | Parallel wave runner (bash 3.2 portable) |
| T9 fix | f3b0b11 | awk ENVIRON[] for multi-line values |
| T10  | 83548c6  | Wave merger (squash + post-wave test) |
| T11  | 9090144  | codex-implement entry + preflight + dry-run |
| T12  | f3b0b11  | Rollback integration test |
| T13  | 8536287  | SKILL.md Step 2D + description update |
| T14  | dcd6463  | End-to-end integration test |

**Test suite:** 11/11 passed (`.claude/skills/gstack/codex/tests/run-all.sh`)

## Notable implementation deltas from the written plan

- **Bash 3.2 portability** in `codex-run-wave`. macOS ships bash 3.2; the plan's
  `declare -A` + `wait -n` required bash 4+. Rewrote with file-based forbidden
  maps + poll-based `reap_any`/`reap_all`.
- **awk ENVIRON[] in render_prompt**. Plan used `awk -v body="$body"`; awk's -v
  rejects newlines in values, so multi-line task bodies broke it.
- **codex-dispatch-task jq tolerance**. Test stubs echo bare `DONE`; jq on
  non-JSON + `set -euo pipefail` aborted the script silently. Now wrapped in
  `{ jq ... || true; }`.
- **codex-gate diff silencing**. `git diff BASE...HEAD` stderr went to user on
  empty-base cases; redirected to `/dev/null`.
- **test-preflight**. The plan's dirty-tree assertion used `--dry-run`, but
  dry-run short-circuits preflight. Test uses a full-run invocation for the
  dirty-tree case and a dry-run for the summary assertion.
- **test-rollback / test-e2e fake codex**. Plan's fake matched on filename
  (`ra.txt`/`a.txt`) which also appears in the forbidden-files prompt list,
  so both tasks got both files. Fakes now match on `Create: \`FILE\``.
- **e2e fixture Run lines**. Plan had `Run: echo X > a.txt && git add && git
  commit`, which the gate's Stage 1 re-runs after the fake already made the
  commit — second commit errors with "nothing to commit". Switched Run lines
  to verification-only (`test -r a.txt`).
- **T13 CLAUDE.md edit skipped**. The committed CLAUDE.md on this branch has
  no gstack skill table (it's in an uncommitted diff in main); no target row
  exists to edit.

## Known rollout caveats (carry forward from plan self-review)

- **flock on macOS** — `codex-implement` top-level lock uses `flock`
  unconditionally; on macOS (which ships `shlock`, not `flock`) the lock
  silently fails open. Fix before Phase 3 with homebrew util-linux or add a
  fallback path. The `codex-state` library already has a PID-file fallback.
- **Session-id capture** — Codex CLI may print session IDs to its human log,
  not the JSONL stream. If `--session-file` is empty after attempt 1, attempts
  2/3 silently degrade to fresh sessions. Acceptable for v1.
- **Parser code-fence masking** — Embedded `### Task N:` headings inside
  markdown code fences in a plan file are currently parsed as real tasks.
  Fix before dogfooding on plans with nested code.
- **Resume semantics** — Mid-wave crash → `--resume` is only manually tested.
  Programmatic test deferred to Phase 2 rollout (accepted in plan self-review).
