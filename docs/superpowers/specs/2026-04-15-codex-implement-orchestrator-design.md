# `/codex implement` — Plan Orchestrator Design

**Date:** 2026-04-15
**Status:** Approved design, ready for implementation plan
**Owner:** Will
**Skill target:** `nanoclaw/.claude/skills/gstack/codex/` (vendored gstack skill)

---

## Goal

Add a 4th mode to the existing `/codex` skill — `/codex implement <plan-file>` — that takes an approved superpowers-style implementation plan and executes its tasks in parallel waves by dispatching OpenAI Codex (via `codex exec -s workspace-write`) as the implementer, with per-task isolation via git worktrees, a three-stage merge gate (tests → `codex review` → Claude spec-compliance check), automatic retry + Claude fallback on failure, and resume-from-checkpoint on crash or partial failure.

## Motivation

- Current `/codex` skill is read-only (`-s read-only`) across all three modes. Codex's ability to actually write code is unused.
- The user has a ChatGPT Pro plan on Codex, so per-token cost is not a constraint on aggressive parallel use.
- Locked implementation plans already declare independent tasks. Running them serially through Claude subagents leaves parallelism on the table.
- `codex review --base origin/main` has been proven to catch P1s that plan review missed (5 found on VAD v1) — it belongs in the gate, not just in a separate manual command.

## Non-Goals (v1)

- Cross-plan concurrency (two `/codex implement` runs on the same plan simultaneously — forbidden by flock).
- Plugin architecture for custom merge gates or parsers. (Deferred; can layer later if needed.)
- Mid-task human intervention UI. The user can watch logs or kill the run; no partial-approval flow.
- Automatic plan writing. The plan is a prerequisite; this tool only executes.
- Touching plans that lack a `## Parallelization` section (they run fully serial and print a warning).

---

## Architecture Overview

**Invocation:** `/codex implement <plan-file> [--resume] [--dry-run] [--rollback] [--base <branch>] [--only-task N] [--task-timeout <sec>] [--force] [--force-clean]`

Added as `Step 2D` to `nanoclaw/.claude/skills/gstack/codex/SKILL.md`, alongside the existing `review` (2A), `challenge` (2B), and `consult` (2C) modes.

**High-level lifecycle:**

1. **Parse** the plan file → task list + wave DAG + per-task metadata.
2. **State init:** create `~/.gstack/codex-work/<plan-slug>/state.json` (or load it if `--resume`).
3. **For each wave, in declared order:**
   a. Spin up one git worktree per task at `~/.gstack/codex-work/<plan-slug>/<task-slug>/` on a branch `codex/<plan-slug>/<task-slug>` forked from `--base` (default `origin/main`).
   b. Dispatch `codex exec -s workspace-write -C <worktree> …` for all wave tasks in parallel.
   c. Wait for all to complete. Per task, run the merge gate (tests → `codex review` → Claude spec check). On failure, re-dispatch Codex with findings per the retry ladder. On persistent `BLOCKED`, fall back to a Claude Task() subagent.
   d. Squash-merge each passing task branch back to `--base` in declared order. On conflict → abort, checkpoint, escalate.
   e. Tear down worktrees.
4. **Final step:** run the plan's global test command on `--base` post-merge. Green → print summary. Red → checkpoint + escalate.

**Process boundaries — two-layer control flow:**

The orchestrator is **not** a pure bash script. It's a coordinated workflow:

- **Claude (the current session)** is the coordinator. It owns the top-level loop: "for each wave, run the bash orchestrator, then dispatch Task() subagents for Stage 3 spec checks + Claude-fallback attempt 4, then continue." Claude reads state.json between phases and calls Task() directly — bash cannot dispatch Claude subagents.
- **Bash helper scripts** (`bin/codex-implement`, `codex-run-wave`, `codex-parse-plan`, etc.) do the plumbing: worktree setup, `codex exec` dispatch with background subshells + `wait`, running tests, running `codex review`, git merge operations, state file updates.
- **Inter-layer protocol.** Bash writes task status + findings to `state.json` and to per-task marker files (e.g. `needs-spec-check.json`, `needs-claude-fallback.json`). Claude polls state after each bash phase, handles any markers by dispatching Task(), writes results back to files the next bash phase reads.

Why this split: `codex exec`, `codex review`, git plumbing, and parallel `wait` are cleanly shell-native. Task() subagents are only callable from Claude's session. This design keeps each tool doing what it's best at, and the two layers synchronize through state.json + marker files. Neither layer blocks on the other for long — Claude dispatches quickly, bash plumbing is deterministic.

Parallel Codex invocations use background subshells + `wait`. Each task's stdout/stderr streams to `~/.gstack/codex-work/<plan-slug>/logs/<task-slug>.log`.

**Preflight checks (before any dispatch):**
- `--base` exists and its working tree is clean (no uncommitted changes, no untracked files that would collide). Fail loudly otherwise.
- `codex` CLI is on PATH and authenticated (`codex login status` exits 0).
- `git worktree` is supported (Git ≥ 2.5).
- No stale lockfile (or `--force-clean` was passed).

**Fan-out ceiling.** Even if a wave declares 8 parallel tasks, spawn at most `--max-parallel` (default 4) Codex processes at a time. Codex Pro rate limits are not advertised, but bursting 8+ parallel `codex exec` calls risks throttling that would cascade into gate failures. Tasks queue past the ceiling and start as slots free up.

---

## Plan Parsing & Task Extraction

**Task identification.** Split the plan file on `^### Task \d+:` headings (canonical superpowers `writing-plans` format). Each section = one unit of work. Task slug = slugified `[Component Name]` from the heading.

**`## Parallelization` section (new convention):**

```markdown
## Parallelization

- Wave 1: Tasks 1, 3
- Wave 2: Tasks 2, 4, 5
- Wave 3: Task 6
```

Parser rules:
- No `## Parallelization` section → treat as fully serial (each task its own wave), print a warning.
- A task referenced twice → hard error before any dispatch.
- A task not referenced at all → hard error.
- Wave ordering is declaration order.

**Per-task metadata parsed from the task body:**
- `**Files:**` block → used for cross-task conflict detection within a wave. Two parallel tasks that declare the same file (create or modify) → refuse to start, print the conflict.
- Inline `Run: <command>` steps → captured as the task's test command.
- Everything else (step bodies, code blocks) → passed verbatim into the Codex prompt.

**Global test command:** `**Test command:**` field in the plan header — used for the post-wave-merge global test run.

**Codex prompt template** (stored as `codex-implementer-prompt.md` alongside the skill):

```
You are implementing ONE task from an approved implementation plan.

PLAN GOAL: {goal}
PLAN ARCHITECTURE: {architecture}

YOUR TASK: {task_heading}

TASK INSTRUCTIONS (complete steps in order):
{task_body}

CONSTRAINTS:
- Work only within the current git worktree.
- Do NOT edit: {files_claimed_by_parallel_tasks}.
- Follow TDD: tests first, then implementation.
- Commit with descriptive messages after each logical step.
- On completion, run: {test_command}
- Report one of: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
  (Matches superpowers:subagent-driven-development status codes.)

[filesystem boundary clause copied from existing /codex skill — do not read
~/.claude/, ~/.agents/, .claude/skills/, or agents/ directories.]
```

**`--dry-run` mode:** parse the plan, print the wave DAG + per-task file claims + any conflicts, exit. No Codex spawned. Intended for validating plan conventions before a real run.

---

## Dispatch, Retry, and Claude Fallback

**Per-task dispatch (parallel across a wave):**

```bash
codex exec \
  -s workspace-write \
  -C <worktree> \
  -c model_reasoning_effort="high" \
  --enable web_search_cached \
  --json \
  "<rendered prompt from codex-implementer-prompt.md>" \
  > logs/<task-slug>.jsonl 2> logs/<task-slug>.err &
echo $! > pids/<task-slug>.pid
```

All wave tasks kick off in parallel; orchestrator `wait`s on the PID set. Per-task timeout = 30 min (configurable via `--task-timeout`). Timeout → `BLOCKED`.

**Status detection.** Parse the last structured message from the Codex JSONL stream. Match against the four codes (DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED). If no status code is present, synthesize from exit code + test command result.

**Retry ladder (per task, on gate failure or BLOCKED):**

| Attempt | Action |
|---|---|
| 1 | Fresh `codex exec` session with `model_reasoning_effort=high`. Captures and persists the session id. |
| 2 | **Resume** attempt 1's session via `codex exec resume <session-id>` with the gate findings as the resume prompt (`PRIOR ATTEMPT FAILED BECAUSE: <findings>. Fix and re-verify.`). Same reasoning context, now with concrete feedback. |
| 3 | Resume the same session again at `model_reasoning_effort=xhigh` (same session-id, raised reasoning effort on top of accumulated context). |
| 4 | Claude fallback: dispatch a fresh Claude Task() subagent with task prompt + prior Codex attempt summaries + the `superpowers:subagent-driven-development` `implementer-prompt.md` template. Same worktree + branch (continues where Codex stopped; does not discard Codex's partial progress unless the findings indicate the wrong direction). |
| 5+ | Escalate — checkpoint, print full attempt log, stop the wave. |

Attempts 2 and 3 reuse the Codex session so reasoning context accumulates — Codex doesn't re-explore the task from scratch each retry, it responds to concrete feedback. Only attempt 4 (Claude fallback) starts with a fresh model context.

Gate findings flow into retries — Codex isn't guessing on retry, it's responding to concrete feedback.

**Claude fallback input bundle:**
- Original task body.
- All prior Codex attempt summaries (what was tried, what failed).
- The worktree path + branch (continues, does not restart).
- Instructions to commit its own work and report the same DONE/BLOCKED codes.

**Parallel coordination primitives:**
- `flock -n ~/.gstack/codex-work/<plan-slug>/lock` — prevents two runs on the same plan. Different plans can run concurrently.
- One PID file per task, cleaned on completion.
- Logs are append-only and survive across resume.

**Live observability during a run:**
- Orchestrator prints a status table every 30s:
  ```
  [WAVE 2/5] task-1: running (12m) · task-3: gate-check · task-5: DONE
  ```
- User can `tail -f ~/.gstack/codex-work/<plan-slug>/logs/<task-slug>.log` in another terminal to watch any task's Codex reasoning stream.

---

## Merge Gate & Fix Loop

Runs inside the task worktree before we try to bring changes back to `--base`. Three stages, short-circuit on first failure.

**Stage 1 — Task-local tests.** Run the task's declared test command inside the worktree. Pass = exit 0. Fail = capture last 100 lines of stdout+stderr, list failing test names → findings.

**Stage 2 — `codex review --base <base>`.** Run the existing `/codex review` pipeline against the diff between the task branch and `--base`. Pass = no blocking issues. Fail = review output verbatim → findings. Non-optional; this gate caught 5 P1s on VAD v1.

**Stage 3 — Claude spec-compliance check.** Dispatch a Claude Task() subagent using the `spec-reviewer-prompt.md` template from `superpowers:subagent-driven-development`. Inputs: task body, full diff (`git diff <base>...HEAD`), plan goal+architecture. Subagent reports pass/fail + specifics.

**Gate loop:**

```text
gate_attempt = 1
while gate_attempt <= 3:
  run Stage 1 → Stage 2 → Stage 3
  if all pass: break
  findings = concat(stage_failures)
  re-dispatch Codex per retry ladder with findings
  gate_attempt += 1
if still failing after attempt 3: Claude fallback (retry ladder attempt 4)
if Claude fallback also fails the gate: checkpoint + escalate
```

**Squash-merge into `--base` (after all wave tasks pass):**

Merge order within a wave = ascending task number (e.g. Wave 1 listing `Tasks 1, 3` merges Task 1 first, then Task 3). This is deterministic and matches the plan's own numbering.

```bash
git checkout <base>
for task in sorted(wave.tasks, key=task_number):
  git merge --squash codex/<plan-slug>/<task-slug>
  if conflict:
    git merge --abort
    mark task BLOCKED (reason=post-merge-conflict-with-earlier-task-in-wave)
    break out of wave, checkpoint, escalate
  git commit -m "task N: <component>

  via /codex implement

  Co-Authored-By: Codex (gpt-5-codex) <noreply@openai.com>
  Co-Authored-By: Claude (claude-opus-4-6) <noreply@anthropic.com>"
```

**Why squash, not merge-commit.** Each task lands as one clean commit on `--base` — the log reads as `task 1 … task 2 … task 3 …` in plan order. Preserves bisectability. Per-task intermediate commits remain on the worktree branch, which is deleted at wave teardown.

**Post-wave-merge global test run:** after all wave tasks in a wave are squash-merged, run the plan's `**Test command:**` on `--base`. Red → checkpoint + escalate (tasks passed in isolation but composed badly — per-task gates didn't catch it).

**Escalation format:**

```
[ESCALATE] plan=<plan-slug> wave=<N> task=<task-slug>
  reason: <short>
  attempts: 4 (3 Codex + 1 Claude fallback)
  last_findings: <path to log>
  state: checkpointed — resume with `/codex implement <plan-file> --resume`
```

---

## State, Resume, Rollback

**State file:** `~/.gstack/codex-work/<plan-slug>/state.json`. Written after every state transition with `flock` + atomic rename (`tmpfile → rename`). Crash-safe; no torn writes.

**Schema:**

```json
{
  "plan_path": "absolute/path/to/plan.md",
  "plan_sha": "<sha256 of plan file at run start>",
  "base_ref": "origin/main",
  "base_sha_at_start": "<sha>",
  "started_at": "2026-04-15T14:22:00Z",
  "last_updated_at": "2026-04-15T14:47:13Z",
  "waves": [
    {
      "wave": 1,
      "status": "completed",
      "merged_at": "2026-04-15T14:31:00Z",
      "merge_base_sha": "<sha after merge>",
      "tasks": [
        {
          "task": 1,
          "slug": "parse-plan-file",
          "status": "merged",
          "attempts": [
            {"attempt": 1, "impl": "codex-high", "session_id": "<uuid>", "result": "gate-fail", "findings": "path"},
            {"attempt": 2, "impl": "codex-high", "session_id": "<uuid>", "result": "done"}
          ],
          "worktree_path": "~/.gstack/codex-work/<plan-slug>/parse-plan-file",
          "branch": "codex/<plan-slug>/parse-plan-file",
          "final_commit_on_base": "<sha>"
        }
      ]
    },
    {
      "wave": 2,
      "status": "in_progress",
      "tasks": [
        {"task": 3, "slug": "wave-scheduler", "status": "gate-check", "attempts": []},
        {"task": 4, "slug": "retry-ladder",   "status": "blocked",    "attempts": []}
      ]
    }
  ]
}
```

Task `status` values: `pending` → `dispatched` → `gate-check` → `merged` | `blocked` | `escalated`.

**`--resume` behavior:**

1. Load state.json. Recompute the plan file's sha256. If changed since `started_at` → abort ("plan was edited mid-run; cannot resume safely; either revert plan or use `--force`").
2. Verify `base_ref` head hasn't diverged destructively — merged commits must still be reachable from `base_ref`. If not → abort (history was rewritten; unsafe).
3. Skip fully-merged waves. For the first incomplete wave:
   - `merged` tasks: skipped.
   - `blocked`/`escalated` tasks: retry from attempt 1 (fresh worktree + branch; old ones torn down and recreated).
   - `dispatched`/`gate-check` tasks (orchestrator crashed mid-task): tear down worktree, restart from attempt 1.
4. Continue wave-by-wave normally.

**Rollback (`/codex implement <plan-file> --rollback`):**

Reverts every commit recorded in `final_commit_on_base` across all merged tasks, in reverse order, via a chain of `git revert --no-edit` commits on `--base`. Does not rewrite history. Deletes state file + worktrees. Use when a plan's end-to-end behavior turns out wrong post-merge.

**Worktree lifecycle edge cases:**
- Orphan worktrees from a prior crashed run detected at startup via `git worktree list` + state.json cross-check. Printed to user; cleaned on `--resume` or `--force-clean`.
- Disk full during Codex run → Codex exits with error; task marked blocked; no corruption.
- User manually deletes a worktree mid-run → orchestrator detects absent worktree at gate time; marks blocked.

**Concurrent-run protection:** `flock -n ~/.gstack/codex-work/<plan-slug>/lock`. Second `/codex implement` on the same plan fails immediately with "another run is active (pid=…)".

---

## File Layout

```
nanoclaw/.claude/skills/gstack/codex/
├── SKILL.md                               (extended — add Step 2D: Implement Mode)
├── SKILL.md.tmpl                          (template source — also updated)
├── codex-implementer-prompt.md            (NEW — prompt rendered per task)
├── spec-reviewer-prompt.md                (NEW — Claude spec-check template, adapted from subagent-driven-development)
├── codex-fallback-prompt.md               (NEW — prompt Claude uses when it takes over at attempt 4)
├── bin/
│   ├── codex-implement                    (NEW — entry point, dispatched by SKILL.md Step 2D)
│   ├── codex-parse-plan                   (NEW — plan parser, stdout = wave DAG + metadata JSON)
│   ├── codex-run-wave                     (NEW — dispatch + wait + gate loop for one wave)
│   ├── codex-merge-wave                   (NEW — squash-merge wave tasks into base in order)
│   └── codex-state                        (NEW — state.json read/write with flock + atomic rename)
└── tests/
    ├── fixtures/                          (NEW — sample plan files, happy + edge cases)
    ├── codex-fake                         (NEW — codex CLI shim for integration tests)
    └── test-*.sh                          (NEW — bats-compatible shell tests)
```

---

## Testing

**Three layers.**

**1. Plan-parser unit tests** (shell, fast). Fixture plans under `tests/fixtures/` covering:
- Happy path (header + tasks + `## Parallelization`).
- Missing `## Parallelization` (serial fallback + warning).
- Task referenced twice (hard error).
- Task not referenced (hard error).
- Overlapping file claims within a wave (hard error).
- Malformed task heading (hard error).

**2. Orchestrator integration tests with a fake codex shim.** `codex-fake` intercepts `codex exec`, reads a scripted response from `CODEX_FAKE_RESPONSES=/path/to/jsonl`, writes the expected JSONL + exit code. Covers:
- Single-task success.
- Retry ladder (attempt 1 fails gate → attempt 2 succeeds).
- Retry ladder exhausts → Claude fallback fires.
- Gate failures at each stage (tests-only-fail, codex-review-only-fail, spec-check-only-fail).
- Post-merge conflict detection.
- `--dry-run` correctness.
- `--resume` on a checkpointed state.
- `--rollback` generates correct revert chain.

**3. End-to-end smoke test with real codex.** One scripted test with a trivial task (e.g. "add a line to README.md"). Gated behind `CODEX_SMOKE=1` so it doesn't run by default. Confirms the plumbing talks to real codex correctly. Run manually before tagging a new version.

---

## Rollout

**Phase 0 — ship the skill.** Edit SKILL.md + add prompt templates + helper scripts. Commit to nanoclaw. `/codex implement` available immediately.

**Phase 1 — dry-run the next real plan.** When the next Dodami plan lands, run `--dry-run` first. Validate parse output. Adjust plan conventions if needed.

**Phase 2 — tight canary: one task.** Run `--only-task N` on the simplest task. Review commit manually. Build confidence in the gate loop.

**Phase 3 — full parallel run, monitored.** Will watches the live log table. Escalations stop the run; Will approves or aborts.

**Phase 4 — autonomous.** After 2–3 successful Phase 3 runs, treat as an ordinary tool.

**Telemetry** (reuses existing gstack telemetry hook): log per run
`{plan_slug, waves, tasks, attempts_total, blocked_count, claude_fallback_count, duration_ms}`.
Tracks whether Codex-first reduces attempts over time, and flags tasks that routinely fall through to Claude fallback (signal that plan context is under-specified for those tasks).

**Documentation:**
- SKILL.md top-of-file description: bump "three modes" → "four modes".
- New `## Step 2D: Implement Mode` section mirroring 2A/2B/2C.
- New `## Plan Parallelization Convention` reference section so future plan authors know the format.
- One-line note in nanoclaw `CLAUDE.md` under the codex skill reference.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Codex Pro rate limits under parallel fan-out | `--max-parallel` ceiling (default 4). Tasks beyond that queue and start as slots free. |
| Claude coordinator context bloat from Stage 3 spec checks and fallbacks | Task() subagents receive curated inputs (task body + diff + plan goal) and return short pass/fail + findings. No long conversation context leaks back. |
| `~/.codex/` session file accumulation | Session IDs per task are recorded in state.json. `--rollback` and `--force-clean` delete the corresponding sessions via `codex sessions delete <id>`. |
| User has uncommitted work on `--base` when orchestrator starts | Preflight check refuses to run until tree is clean. |
| Plan file edited mid-run | `plan_sha` is stored at start; `--resume` aborts if the sha changed. `--force` bypasses for advanced users. |
| `--base` history rewritten while orchestrator was running | `--resume` verifies that `base_sha_at_start` and merged task commits are still reachable from `--base`. Aborts otherwise. |
| Orphan worktrees from crashed runs | Detected at startup via `git worktree list` + state.json cross-check. Cleaned on `--resume` or `--force-clean`. |
| Two `/codex implement` runs on the same plan | `flock` on `~/.gstack/codex-work/<plan-slug>/lock`. Second run fails immediately with the active PID. |
| Tasks that composed fine in isolation but break integrated | Post-wave-merge global test run on `--base` catches this; escalates with checkpoint. |

## Decisions Locked

| # | Decision | Chosen |
|---|---|---|
| 1 | v1 scope | Plan orchestrator |
| 2 | Isolation | Per-task git worktree |
| 3 | Merge gate | Tests + `codex review` + Claude spec check |
| 4 | Resilience | Resume from checkpoint + Claude fallback at retry attempt 4 |
| 5 | Merge strategy | Squash-merge each task into `--base` in ascending task-number order within a wave |
| 6 | Task extraction | `^### Task N:` headings + new `## Parallelization` section |
| 7 | Control flow | Two-layer: Claude coordinator + bash plumbing, synced via state.json + marker files |
| 8 | Retry session strategy | Attempts 2 and 3 resume Codex session; attempt 4 starts fresh Claude Task() |
| 9 | Parallel fan-out ceiling | `--max-parallel` default 4 |
| 10 | Plugin system | Deferred |

## Open Questions

None. All architectural decisions locked during brainstorming.
