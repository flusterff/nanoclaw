# NanoClaw

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Session Protocol (HARD RULES — do not skip)

These are the top-of-session actions. Will set durable memories asking for them and then had to re-explain the ask to multiple sessions. That's the bug this section fixes. Perform these unconditionally — do not wait for the user to remind you.

### At session start

1. **Read `~/.claude/projects/-Users-will-nanoclaw/memory/SYNC.md` first.** Scan the top ~100 lines for what other sessions shipped recently + any `🔄 IN PROGRESS` entries. You share a repo with parallel sessions; treat SYNC.md as the source of truth for "what state is the world in right now."
2. **Skim the 2-3 most recent session logs** at `~/Dodami/nanoclaw/organized/session_logs/` (only if they exist) for context on previous arcs.
3. **Tag the session color** via `/set-color <name>` if one hasn't been set for this worktree yet. Pick a color not used in recent SYNC entries (avoid colliding with an active parallel session). Telegram notifications are color-tagged — without this you're "unlabeled session" to Will. **Codex exception:** Codex-Claude sessions must use `/Users/will/.local/bin/codex-claude-session --root /Users/will/nanoclaw` for the current session color. Do not answer Codex color questions from `.claude/session-color`; that file is only the Claude/worktree default.
4. Only AFTER the above, begin the user's actual request.

### During work — SYNC.md is a live log, not an end-of-session report

5. **Write a `🔄 IN PROGRESS` entry to SYNC.md at the START of any non-trivial task** (anything that will create/modify a PR, touch the 5090, or take more than a few minutes). Format:
   ```markdown
   ### Session <Color> — <Task Name> (<YYYY-MM-DD>) 🔄 IN PROGRESS
   **What:** one-line summary
   **Branch:** feat/whatever
   **Started:** <HH:MM KST>
   ```
6. **Update to `✅ SHIPPED` the moment the task finishes** (merge, deploy, or whatever defines "done"). Add the PR number, what shipped, codex rounds, any env var / deploy changes. Don't batch this for end-of-session — by then you'll forget details and another session may have collided.
7. **Every PR merge → SYNC.md entry.** Every 5090 deploy → SYNC.md entry. Every env var added to `~/.dodami_env` → note it in SYNC.md (future sessions can't see the 5090's env).

### Why the catch-up pattern is a failure mode

If a session runs for hours and only writes SYNC.md at the end, parallel sessions spend the whole time colliding with it. Catching up at the end means you write a big entry that misses nuance (what you *tried* and backed out, what you *almost* merged but didn't). Write small and often.

### Self-audit

When the user asks "did you update SYNC / what color is this session?", the honest answer should always be "yes, here's the entry / this is <color>." If it isn't, you skipped the protocol — write the catch-up entry and tag the session BEFORE anything else.

## Code Change Discipline

**Before modifying any function:** grep for ALL callers and references first. Map downstream dependencies before touching code. The #1 source of bugs is editing a function without realizing another function uses the same variable names, data shapes, or assumptions differently.

**When debugging:** do NOT guess-and-patch. Read the actual error, trace the root cause in the code, and fix it precisely. No try-except wrappers, no parameter tweaks, no "maybe this will work" patches. If you can't explain WHY it's broken, you don't understand it well enough to fix it.

## Quick Context

Single Node.js process with skill-based channel system. Channels (WhatsApp, Telegram, Slack, Discord, Gmail) are skills that self-register at startup. Messages route to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/registry.ts` | Channel registry (self-registration at startup) |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/` | Skills loaded inside agent containers (browser, status, formatting) |

## Skills

Four types of skills exist in NanoClaw. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full taxonomy and guidelines.

- **Feature skills** — merge a `skill/*` branch to add capabilities (e.g. `/add-telegram`, `/add-slack`)
- **Utility skills** — ship code files alongside SKILL.md (e.g. `/claw`)
- **Operational skills** — instruction-only workflows, always on `main` (e.g. `/setup`, `/debug`)
- **Container skills** — loaded inside agent containers at runtime (`container/skills/`)

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |

## Contributing

Before creating a PR, adding a skill, or preparing any contribution, you MUST read [CONTRIBUTING.md](CONTRIBUTING.md). It covers accepted change types, the four skill types and their guidelines, SKILL.md format rules, PR requirements, and the pre-submission checklist (searching for existing PRs/issues, testing, description format).

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Run with hot reload
npm run build        # Compile TypeScript
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Troubleshooting

**WhatsApp not connecting after upgrade:** WhatsApp is now a separate skill, not bundled in core. Run `/add-whatsapp` (or `npx tsx scripts/apply-skill.ts .claude/skills/add-whatsapp && npm run build`) to install it. Existing auth credentials and groups are preserved.

## gstack

Use `/browse` from gstack for **all web browsing**. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:

| Skill | Purpose |
|-------|---------|
| `/office-hours` | Office hours workflow |
| `/plan-ceo-review` | CEO review planning |
| `/plan-eng-review` | Engineering review planning |
| `/plan-design-review` | Design review planning |
| `/design-consultation` | Design consultation |
| `/review` | Code review |
| `/ship` | Ship code |
| `/land-and-deploy` | Land and deploy |
| `/canary` | Canary deployment |
| `/benchmark` | Performance benchmarking |
| `/browse` | Web browsing (use this for ALL web browsing) |
| `/qa` | Quality assurance |
| `/qa-only` | QA only (no fixes) |
| `/design-review` | Design review |
| `/setup-browser-cookies` | Set up browser cookies |
| `/setup-deploy` | Set up deployment |
| `/retro` | Retrospective |
| `/investigate` | Investigate issues |
| `/document-release` | Document a release |
| `/codex` | Codex workflow |
| `/cso` | CSO workflow |
| `/improve-demo` | Automated quality improvement loop (7 judges → fix → re-judge until 9.5) |
| `/autoplan` | Auto-planning |
| `/careful` | Careful mode |
| `/freeze` | Freeze changes |
| `/guard` | Guard mode |
| `/unfreeze` | Unfreeze changes |
| `/gstack-upgrade` | Upgrade gstack |

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
