#!/usr/bin/env bash
# PreCompact hook: remind before Claude Code compacts context.
# Print-only and fail-open; it never runs /handoff save.

cat >/dev/null 2>&1 || true

printf '%s\n' 'If you have in-progress work that should survive compaction, run `/handoff save` now (or `/handoff save <title>`).'
exit 0
