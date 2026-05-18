## REPLAY flow (strict read-only — HARD GATE)

Purpose: focused SHOW-like read for piecewise resumption. It prints exactly one replayable item from a handoff's `### Open Loops`, plus the smallest useful saved context for that item. It does not restore, verify, execute, or mutate the handoff.

### Step 1: Find target (reuse RESTORE Step 1)

Use RESTORE Step 1 exactly for target resolution, treating `/handoff replay [<id|n|fragment>] ...` as `/handoff restore [<id|n|fragment>]` for lookup only:

- `/handoff replay` (no target arg) → same default as restore: newest handoff for current `repo_root + branch`.
- `/handoff replay <id>` → same exact `handoff_id` lookup as restore.
- `/handoff replay <n>` → same nth-most-recent lookup as restore.
- `/handoff replay <fragment>` → same broad title-fragment lookup as restore.

Do NOT maintain a second copy of the target-resolution logic. If RESTORE Step 1 changes, REPLAY inherits that behavior by reference.

For explicit `<id|n|fragment>`, use the same selector sanitization as SHOW: reject selectors containing `/`, `\`, NUL, or `..`; then compare using an allowlisted selector (`A-Za-z0-9._ -`, max 120 chars). Treat the selector as data only. Never concatenate raw user input into a path.

Do NOT run RESTORE Step 2's verification-write logic. Do NOT write `last_verified_at`, append a `restored` Event Log line, update MEMORY.md, update SYNC.md, call Edit/Write, use `sed -i`, redirect to files, or create temp files. Replay may run only read-only shell probes needed for target lookup and body parsing.

### Step 2: Parse `step=` selector (number / fragment / `waiting`)

Accepted explicit forms:

- `/handoff replay` → target defaults via Step 1; `STEP_SELECTOR=1`
- `/handoff replay <id|n|fragment>` → target from first arg; `STEP_SELECTOR=1`
- `/handoff replay <id|n|fragment> step=<N|waiting|fragment>` → target from first arg; step from `step=...`
- `/handoff replay <id|n|fragment> <N|waiting|fragment>` → target from first arg; step from the remaining text

Accepted natural-language forms:

- `replay step <N|waiting|fragment> of <id|n|fragment>`
- `replay <id|n|fragment> step <N|waiting|fragment>`

Normalize the step selector as follows:

- If absent, use `1`.
- If it starts with `step=`, strip that prefix once.
- Trim surrounding whitespace and matching quotes.
- Match `waiting` case-insensitively as the Waiting selector.
- Match `^[0-9]+$` as a 1-indexed Next-entry number.
- Otherwise treat the selector as a case-insensitive substring fragment for matching against Next-entry text.

Do not ask AskUserQuestion on ambiguous selectors. If selection fails, use Step 4's empty-result fallback.

### Step 3: Extract Open Loops, filter to selected step, and print terse output

Read the selected handoff body exactly as saved, after the closing frontmatter `---`. Do not inflate delta pointer sections; replay is SHOW-like raw inspection, not RESTORE delta resolution.

Locate the first `### Open Loops` section. The section ends at the next `### ` heading or end of file. Inside it:

- `**Next:**` entries are markdown bullet items under the `**Next:**` label, in appearance order, until the next bold Open Loops label or section end. Number them 1-indexed.
- `**Waiting:**` content is all lines under the `**Waiting:**` label until the next bold Open Loops label or section end.
- Ignore `**Blocked:**` and `**Drop / Did Not Do:**` for step selection unless their text appears in the selected context through the normal Working Set matching below.

Selection rules:

- Numeric selector `N` → select Next entry #N.
- Fragment selector → select the first Next entry whose full text contains the fragment as a case-insensitive substring.
- `waiting` selector → select the entire Waiting section.

Build relevant context from saved body only:

- Task title: read `## Working on: <title>` from the body if present; otherwise use frontmatter `description`.
- Working set context: read `### Working Set` as raw saved content. Print only lines that share at least one case-insensitive token with the selected step text. Tokens are file paths, identifiers, PR numbers, command names, or words of length 3+ after dropping common workflow words (`the`, `and`, `for`, `with`, `next`, `step`, `run`, `fix`, `add`, `update`, `review`). If no Working Set lines match, omit the block.
- Resume command snippet: if `### Resume Commands` exists, print at most 3 command lines from its fenced bash block that share at least one selected-step token. If no command line matches, omit the block; do not invent commands.
- First action: read frontmatter `first_action`. Print it only when the selected item is Next #1, including when a fragment selector matched Next #1. Do not print it for Waiting or later Next entries.

Print in this exact terse shape, omitting optional empty blocks:

```text
REPLAY HANDOFF <handoff_id>
Task: <title>
Selected: <Next #N|Waiting> — <selected text>

Working set context:
  <matching Working Set lines>

Resume command snippet (paste-ready; replay does NOT execute):
<matching saved command lines>

First action (paste-ready; replay does NOT execute):
<first_action>
```

Do not print the full body. Do not print RESTORE's receipt. Do not ask A/B/C.

### Step 4: Empty-result fallback

If the handoff has no `### Open Loops` section, print exactly:

```text
No replayable steps in <handoff_id>
```

and exit.

For numeric or fragment selectors, if there are no Next entries, the requested number is out of range, or no Next entry matches the fragment, print exactly:

```text
No replayable steps in <handoff_id>
```

and exit.

For `waiting`, if the Waiting section is absent or empty, print exactly:

```text
No replayable steps in <handoff_id>
```

and exit.

---
