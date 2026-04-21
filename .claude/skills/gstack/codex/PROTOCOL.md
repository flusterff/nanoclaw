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
  "task_body": "...",
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
  "findings_text": "...",
  "completed_at": "..."
}
```

Then Claude deletes the `needs-spec-check.*.json` file.

**`needs-claude-fallback.<wave>.<task-num>.<gen>.json`** — bash writes when
attempts 1-3 fail. `<gen>` is a per-request generation suffix
(`<pid>-<epoch>`) that keeps a stale reply from a previous run from being
consumed by a restarted attempt. Claude reads, dispatches a Claude Task()
subagent using `codex-fallback-prompt.md`, waits for completion, writes:

**`claude-fallback-result.<wave>.<task-num>.<gen>.json`** (use the same
`<gen>` suffix as the matching request marker — the standard substitution
`needs-claude-fallback` → `claude-fallback-result` preserves it):

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
