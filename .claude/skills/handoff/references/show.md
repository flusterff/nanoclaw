## SHOW flow (strict read-only — HARD GATE, no AskUserQuestion)

Purpose: zero-friction restore option B. It prints the restore receipt header plus the full saved handoff body in one shot.

### Step 1: Find target (reuse RESTORE Step 1)

Use RESTORE Step 1 exactly for target resolution, treating `/handoff show [<id|n|fragment>]` as `/handoff restore [<id|n|fragment>]` for lookup only:

- `/handoff show` (no arg) → same default as restore: newest handoff for current `repo_root + branch`.
- `/handoff show <id>` → same exact `handoff_id` lookup as restore.
- `/handoff show <n>` → same nth-most-recent lookup as restore.
- `/handoff show <fragment>` → same broad title-fragment lookup as restore.

Do NOT maintain a second copy of the target-resolution logic. If RESTORE Step 1 changes, SHOW inherits that behavior by reference.

For explicit `<id|n|fragment>`, sanitize before lookup: reject selectors containing `/`, `\`, NUL, or `..`; then compare using an allowlisted selector (`A-Za-z0-9._ -`, max 120 chars). Treat the selector as data only. Never concatenate raw user input into a path.

### Step 2: Build the read-only receipt header

Run RESTORE Step 2's staleness probe and print RESTORE Step 3's receipt header. This may use read-only git commands and optional read-only `gh pr view` for PR state only.

Compute `last_verified_at` for display only. Do NOT write `last_verified_at` or any other frontmatter field back to the handoff file.

### Step 3: Print the full body and exit

After the receipt header, print:

```text
--- Full handoff body ---
<all non-frontmatter body text from the selected handoff>
--- End handoff ---
```

Read the selected handoff file and print the body exactly as saved, including any delta pointer lines like `<see parent_handoff: <id> for unchanged <section-name>>`. Delta resolution is RESTORE's job; SHOW is a raw inspection flow. Do not ask A/B/C. Do not call Edit/Write. Do not perform shell mutations (`sed -i`, redirects to files, temp-file writes, status updates) and do not make external API calls beyond optional read-only `gh pr view` from the staleness probe.

---
