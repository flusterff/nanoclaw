---
name: handoff
description: |
  Save / restore / show / replay / rules / list cross-session handoffs. Captures git state,
  decisions, deviations, working set, open loops + generates a copy-paste resume prompt.
  Symmetric restore/show/replay plus rules surfacing: a fresh session runs /handoff restore
  to load a read-only receipt, /handoff show to print that receipt plus the full body
  without a prompt, /handoff replay to print one Open Loops step plus focused saved
  context, or /handoff rules to surface repeated handoff patterns as print-only
  CLAUDE.md rule proposals.
  Triggers on "handoff", "save and switch", "new session", "pick up later",
  "prepare handoff", "save progress for next session", "resume", "where was I",
  "restore context", "show handoff", "replay handoff", "replay step",
  "list handoffs", "what handoffs do I have", "handoff rules", "propose rules",
  "surface patterns", "what should I remember".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# /handoff — Cross-Session Handoff (v2)

Manage handoffs with six subcommands: `save`, `restore`, `show`, `replay`, `rules`, `list`.

**HARD GATE (applies to all subcommands):** This skill NEVER modifies code or arbitrary files. It writes ONLY: (1) new handoff files in the memory dir, (2) MEMORY.md index entries, (3) SYNC.md coordination entries when relevant, (4) `status:` field updates on superseded prior handoffs (metadata-only frontmatter mutation), (5) restore-time `last_verified_at:` field writes on the selected handoff (metadata-only frontmatter mutation), (6) append-only `### Event Log` body writes on handoff files for lifecycle audit events during SAVE, RESTORE, supersession, and explicit shipped/abandoned status marking. Explicit `/handoff save --stash` (or an explicit save-time `stash` keyword) is the only opt-in git mutation this skill may perform: when requested, SAVE may run `git stash push -u -m "handoff_<handoff_id>"` after capturing the dirty-tree capsule and before confirmation. This is a save-time side effect, not a restore-time action; it is never automatic, and restore/show only print a paste-ready `git -C "<saved repo_root>" stash pop "$(git -C "<saved repo_root>" stash list | grep 'handoff_<handoff_id>' | head -1 | cut -d: -f1)"` cue. Restore never executes the handoff: restoring a handoff with `first_action: edit X.py` prints that line as a paste-ready prompt for the user's NEXT turn — it does NOT execute it inside the skill invocation. The only restore writes are the `last_verified_at:` frontmatter write after the staleness probe plus one append-only `restored` Event Log line; show, replay, and rules are strictly read-only. Show prints the restore receipt plus the full saved body without AskUserQuestion, and does not write frontmatter fields or Event Log lines. Replay is SHOW-like, not RESTORE-like: it prints one selected Open Loops step plus relevant saved context, and does not write `last_verified_at`, append Event Log lines, mutate frontmatter, or call RESTORE's verification-write logic. Rules scans recent handoff files and prints candidate CLAUDE.md rule additions only; it never writes CLAUDE.md, project CLAUDE.md, MEMORY.md, SYNC.md, handoff files, or any other rule file.

<!-- prettier-ignore-start -->
## Subcommand routing

Parse the user's input in this priority order. Stop at the first match.

### 1. Explicit subcommand keyword

- `/handoff save [--stash] [--delta|--full] [<title>]` → **save**
- `/handoff restore [<id|n|fragment>]` → **restore**
- `/handoff show [<id|n|fragment>]` → **show**
- `/handoff replay [<id|n|fragment>] [step=<N>|<fragment>]` → **replay**
- `/handoff rules [--last=<N>]` → **rules**
- `/handoff list [--all]` → **list**

For SAVE only, `--stash` sets `STASH_REQUESTED=true`; `--delta` sets `DELTA_REQUESTED=true`; `--full` sets `FULL_REQUESTED=true`. Strip all recognized flags from the title before title inference. Defaults are `STASH_REQUESTED=false`, `DELTA_REQUESTED=false`, and `FULL_REQUESTED=false`; there is no `--no-stash`. If both `--delta` and `--full` are present, abort before Step 1 with a clear error because they are mutually exclusive.

For RULES only, `--last=<N>` sets `RULES_LAST=<N>` after validating that `<N>` is a positive integer. Default is `RULES_LAST=30`. Strip `--last=<N>` before trigger matching. Do not accept flags that imply writes or installation; RULES is print-only.

For REPLAY only, parse two selectors: `REPLAY_TARGET_SELECTOR` and `REPLAY_STEP_SELECTOR`. If no replay target is provided, use RESTORE Step 1's default newest current `repo_root + branch` target. If one token follows `replay`, treat it as the target selector and default `REPLAY_STEP_SELECTOR=1`. If two or more tokens follow `replay`, treat the first token as the target selector and the remaining text as the step selector. Accept both `step=<N|waiting|fragment>` and a bare step selector (`1`, `2`, `waiting`, or a fragment). Strip only the leading `step=` prefix from the step selector; target lookup still uses RESTORE Step 1.

**Exception (codex review P3 fold):** `/handoff show handoffs` (plural noun, no other args) routes to **list**, NOT show. Check this before treating `handoffs` as a fragment selector. The multi-word list trigger takes precedence over the `show + arg` shape so that the legacy v2.0 phrase remains valid.

### 2. Natural-language trigger phrase (read-only intent gets read-only flow)

When the args (or the user's surrounding message) match a restore/show/replay/rules/list trigger, route to that flow BEFORE the save-with-title fallback. A "resume", "show", "replay", or "rules" intent must NOT silently execute save and write a new handoff/MEMORY/SYNC entry.

Evaluate exact multi-word triggers before bare `show`, bare `replay`, or bare `rules`, so `show handoffs` remains list while `show handoff` routes show, `replay step <N> of <id>` routes replay with an extracted step selector, and `what should I remember` routes rules.

- Restore triggers: `resume`, `where was i`, `pick up where i left off`, `restore context`, `resume context`, `resume work`, `continue session`
- Show triggers: `show`, `show handoff`, `handoff show`
- Replay triggers: `replay`, `handoff replay`, `replay handoff`, `replay step`
- Rules triggers: `rules`, `handoff rules`, `what should i remember`, `propose rules`, `surface patterns`
- List triggers: `list handoffs`, `what handoffs do i have`, `show handoffs`, `handoff list`

For natural-language replay forms, support at least:
- `replay step <N|waiting|fragment> of <id|n|fragment>`
- `replay <id|n|fragment> step <N|waiting|fragment>`
- `replay <id|n|fragment> <N|waiting|fragment>`

If a replay phrase omits the step selector, default to `1`. If a replay phrase omits the target selector, use RESTORE Step 1's default newest handoff for the current `repo_root + branch`.

Match case-insensitively against the first few words of args (or the user message if args are empty).

Save-only modifiers: after routing resolves to SAVE, treat the explicit args `stash`, `with stash`, or `and stash` as `STASH_REQUESTED=true` and strip those words from the title before title inference. Delta/full mode is controlled only by exact flags `--delta` and `--full`; do not infer it from natural-language words. These modifiers do not override restore/show/replay/rules/list trigger matches. Do not ask an AskUserQuestion for stash capture or delta/full capture; the flag/default auto-detect surface is the entire opt-in surface.

### 3. Save defaults

- `/handoff` (no args) → **save**, infer title from conversation
- `/handoff <title>` (first arg not a keyword, not a read-only trigger) → **save** with the given title

---
<!-- prettier-ignore-end -->

## Reference loading contract

After subcommand routing selects a flow, use the Read tool to read that flow's reference file before executing it. Do not execute from this trimmed SKILL.md summary alone; the reference files are the canonical flow bodies.

## Flow write matrix

| Flow    | Write surfaces                                                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SAVE    | New handoff file; MEMORY.md index entry; SYNC.md only when coordination-relevant; prior handoff `status:` frontmatter supersession; append-only Event Log lines; optional explicit `git stash push -u -m "handoff_<handoff_id>"`. |
| RESTORE | Selected handoff `last_verified_at:` frontmatter write; one append-only `restored` Event Log line.                                                                                                                                |
| SHOW    | None; strict read-only.                                                                                                                                                                                                           |
| REPLAY  | None; strict read-only.                                                                                                                                                                                                           |
| RULES   | None; strict read-only.                                                                                                                                                                                                           |
| LIST    | None; strict read-only.                                                                                                                                                                                                           |

## SAVE flow

Creates a new handoff for the current repo/branch, captures git/session state, asks one preservation question when needed, supports full or delta body capture, can optionally create a named stash when explicitly requested, marks prior same-repo/branch in-progress handoffs as superseded, and updates MEMORY.md plus SYNC.md only when coordination-relevant. Before executing, use the Read tool to read `references/save.md` for the full flow.

## RESTORE flow

Selects a saved handoff, runs the staleness probe, writes `last_verified_at:` plus one `restored` Event Log line, inflates delta pointers for the receipt, and prints paste-ready continuation context without executing saved commands or first actions. Before executing, use the Read tool to read `references/restore.md` for the full flow.

## SHOW flow

Looks up a handoff with RESTORE Step 1 semantics and prints the restore-style header plus the raw saved body without AskUserQuestion, staleness writes, Event Log appends, delta inflation, shell mutations, or external write effects. Before executing, use the Read tool to read `references/show.md` for the full flow.

## REPLAY flow

Looks up a handoff with RESTORE Step 1 semantics, selects one replayable Open Loops item, and prints the smallest useful saved context for that item without verification writes, Event Log appends, delta inflation, or execution. Before executing, use the Read tool to read `references/replay.md` for the full flow.

## RULES flow

Scans recent handoff files only, counts repeated workflow patterns from saved handoff content, and prints candidate CLAUDE.md rule drafts for manual copy when at least three distinct handoffs support the pattern. Before executing, use the Read tool to read `references/rules.md` for the full flow.

## LIST flow

Lists handoff files in chronological order, filters by current repo/branch unless `--all` is passed, and prints compact rows with status, dirty flag, next owner, and selector hints without writing anywhere. Before executing, use the Read tool to read `references/list.md` for the full flow.

## Maintenance history

For hook integration, cross-feature notes, failure modes F1-F11, and cuts C1-C8, use the Read tool to read `references/maintenance-history.md`.
