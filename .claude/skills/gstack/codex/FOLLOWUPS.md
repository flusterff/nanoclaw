# /codex implement — Known Follow-Up Issues

These are real bugs caught by 6 rounds of `codex review` merge gates that
are **not blocking the happy path** but should be fixed in a follow-up
pass. The happy-path validation ran clean (3 tasks across 2 waves with
real `codex exec`, 0 gate failures, all commits landed on the base
branch).

Every issue below has been independently confirmed by codex review and
is a narrow edge case. Budget for the initial land was 3 fix-rounds;
this list is what's left after 5.

## Recovery / resume edge cases

### 1. Post-wave global test failure leaves no resumable repair path (P1)

**Where:** `bin/codex-merge-wave`, around line 83 (the merged-task cleanup).

**Problem:** each task is marked `merged` and its worktree is torn down
*before* the post-wave global test runs. If the global test fails, both
`codex-run-wave` and `codex-merge-wave` skip `merged` tasks on
`--resume`, so the bad commits stay on the base branch with no remaining
branch/worktree for the user or orchestrator to edit. The only recovery
path is `--rollback` plus a manual re-author.

**Proposed fix:** defer `codex-worktree teardown` and the `merged`
status write until after the post-wave test passes. Until then keep the
branch reference so `--resume` can run one more attempt against a
richer worktree.

### 2. `--resume` reuses partial task worktrees mid-gate (P2)

**Where:** `bin/codex-run-wave` `process_one` worktree-setup block
(around line 148).

**Problem:** `--resume` restarts `dispatched`/`gate-check` tasks from
attempt 1, but worktree setup only runs when the directory is missing.
A previous run that died mid-edit or mid-gate leaves partial files,
stale session state, and leftover gate artifacts, so the "fresh"
attempt-1 rerun is anything but.

**Proposed fix:** on `--resume`, force-teardown a non-terminal task's
worktree before recreating it. Wipe stale `sid.*`, `findings.*`, and
`needs-*`/`result-*` markers for that task first.

## Plan-semantics edge cases

### 3. Plan-level `**Test command:**` used as per-task gate (P2)

**Where:** `bin/codex-run-wave` around line 141.

**Problem:** the design treats `**Test command:**` as the *post-wave*
global test. But `codex-run-wave` falls back to it for any task that
lacks its own `Run:` line, so stage 1 runs the full integration suite
against each isolated task worktree. In a multi-task plan, otherwise-
valid tasks fail until the rest of the wave is merged.

**Proposed fix:** when a task has no `Run:` line, either skip stage 1
tests or fall back to a no-op (`true`). Keep the plan-level test as
post-wave only.

## Hygiene items found along the way

- SKILL.md still advertises `origin/main` as the default for `--base`;
  the help-text section of the skill should be regenerated to reflect
  the new "local branch required" behavior.
- `package-lock.json` on the feat branch is inconsistent with
  `package.json` (caught by round-1 review). Regenerate with
  `npm install` before shipping to main if npm CI steps are added.
- `src/channels/telegram.ts:223-236` never rejects `connect()` if
  `bot.start()` fails. Orthogonal to /codex implement; separate PR.

## What has been fixed in this landing

- awk gsub `&` corruption in prompt rendering
- codex sandbox can't commit in worktree metadata → bash auto-commits
- `codex review` CLI API change (prompt + `--base` mutually exclusive)
- Spec-check marker enrichment (goal/architecture/task_body per protocol)
- Default base: local `main`/`master` required, no detached-HEAD fallback
- Remote-tracking `--base` refs rejected with clear error message
- Work-dir slug collisions (namespace by repo + plan path hash)
- `--rollback` honors the recorded base_ref from state.json
- `codex-merge-wave` sets `completed` only after the global test passes
- `--resume` skips already-merged tasks in both run-wave and merge-wave
- `codex review` execution errors converted to gate FAIL (not shell trap)
- `--only-task` wired through run/merge/wave-skip
- Stage-3 marker files versioned per attempt
- Stage-3 timeout cleans up stale markers
- PID-file lock fallback for systems without `flock` (macOS)
- Plan parser: fenced code blocks don't count as task headings
- Plan parser: duplicate task numbers now raise an error
- Main loop: iterate declared waves (not `seq 1..length`) for
  non-contiguous wave labels
