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
