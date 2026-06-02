# Spec — Slack #ai-comms context capsule (hook-deposited, host-enforced)

**Date:** 2026-06-02
**Author:** Session Green (Claude Code)
**Status:** APPROVED design (v2) — pending spec review → implementation plan
**Classification:** medium scope, NOT safety-adjacent (founder↔founder coordination). Pre-merge codex review required.
**Validation:** codex gpt-5.5 design-risk consult (`REVISE-WITH-EDITS`, no P0) + 3 research agents (agent-framework handoff / Slack correlation / deposited-context patterns). All edits below trace to those reviews.

---

## 1. Problem

When a Will-side Claude Code session pings Slack `#ai-comms` (e.g. after pushing work or sending a letter), Chanhyeok-AI replies, and the **standing NanoClaw bot ("Will-AI")** answers the reply — **not** the originating session. The standing bot lacks the originating session's context, so its reply is uninformed.

**Verified root mechanism:**
- The standing bot is the **sole Slack Socket Mode listener** (`slack.ts:194-207`). Ephemeral sessions have no Slack connection and cannot receive replies. The bot's 2 s message loop advances its cursor before processing (`index.ts:363-374`), so it wins every reply.
- Sessions post to `#ai-comms` via the Slack MCP server using a **bot token** (`SLACK_MCP_XOXB_TOKEN`). Posts therefore land as the bot's own identity (self) and are stripped by the self-loop guard (`is_from_me` filter, `db.ts` `getMessagesSince`) before the bot builds reply-turn context. **So the bot does not see session pings in channel history.**
- A "session-side listening poll" was assumed to exist; investigation found **none wired**. It is structurally infeasible (no Slack connection in an ephemeral session; races the bot's cursor).

## 2. Goal / Non-goals

**Goal:** the standing bot replies to Chanhyeok-AI **with** the originating session's context, enforced **mechanically** (no discretionary "please read this file" step).

**Non-goals (explicitly out of scope):**
- No claim/ownership/stand-down model; no session-side listener; no new MCP server.
- No Slack threads for the trigger (threads do **not** fire Chanhyeok's listener — verified, `feedback_slack_ping_chanhyeokai.md`).
- No change to the trigger logic, the self-loop guard, Chanhyeok's daemon, or the cross-AI protocol.
- **Deferred (logged, not built in v1):** Slack `metadata` correlation key (reply→ping back-link is unsolvable — Chanhyeok's daemon won't echo it; the numbered pool suffices at our scale); a per-turn re-injected "digest" (host re-injection already achieves continuity).

## 3. Architecture — two mechanical halves + a capsule store

```
Session posts to #ai-comms
   │  (mcp__slack__conversations_add_message)
   ▼
[① PreToolUse hook]  ── writes capsule ──▶  capsule store (~/.nanoclaw_aicomms_capsules/)
   │  + ensures <@Chanhyeok> mention                     │
   ▼                                                     │
Slack #ai-comms  ◀── posts (cleaned) ───────────────────┘
   │
Chanhyeok-AI replies (top-level, @Will-AI)
   ▼
Standing bot message loop (index.ts) builds decision.prompt
   ▼
[② host injection]  ── reads live capsules, prepends numbered pool ──▶ runAgent
   ▼
Bot replies WITH context
```

The bot's session-resume is a **bonus**, not a dependency — the host re-injects live capsules on **every** reply (see §6), so multi-turn continuity does not rely on the bot's (compaction-fragile) session memory.

## 4. Component ① — Session-side PreToolUse hook

**Install:** script committed to the repo at `.claude/hooks/aicomms-capsule.sh`; wired in **user-global `~/.claude/settings.json`** via absolute path so it fires from any of Will's sessions regardless of cwd. Matcher: `mcp__slack__conversations_add_message`. (Rationale: #ai-comms posting may originate from sessions in nanoclaw or ~/Dodami; user-global + channel-gate is the only reliable "fires everywhere" install. The script stays version-controlled in the repo.)

**Behavior (in order):**
1. Read stdin JSON; extract `tool_input.channel_id`, `tool_input.text`, and `tool_use_id` if present.
2. **Channel gate:** if `channel_id != C0B3EPK1XCL` → emit nothing, `exit 0` (allow unchanged — no-op for all other Slack posts).
3. **Brief extraction (optional enrich):** if `text` contains a `<brief>…</brief>` block, capture its contents into the capsule and **strip** the block from the text that will post.
4. **Mention enforcement (codex-strengthened Flag ②):** ensure the **exact** `<@U0B3B7CCEQJ>` (Chanhyeok-AI) is present in the (brief-stripped) text. If absent, **prepend** it. **Idempotent:** if the exact mention is already present → no-op. **Opt-out:** if the text contains a `<humans-only>` (or `<no-ai-mention>`) tag, skip mention injection and strip the tag. Use the encoded `<@…>` form (never plain `@name`); do not double-escape `&`/`<`/`>`.
5. **Deposit capsule** (see §7 schema) to `$AICOMMS_CAPSULE_DIR` (default `~/.nanoclaw_aicomms_capsules/`). **Idempotency key** = `tool_use_id` if available, else `sha256(channel_id + session + cleaned_posted_text)`. **Atomic create; no-op if a capsule with that key already exists** (guards Slack-MCP retries / tool replays → no duplicate capsules).
6. Emit `hookSpecificOutput.updatedInput` with **all** original fields, `text` replaced by the cleaned+mention-injected text; `permissionDecision: "allow"`. `exit 0`.

**Session identity:** best-effort — read the worktree's `.claude/session-color` (or `$CLAUDE_SESSION_COLOR` if set); omit if unavailable.

**Fail-open (hard requirement):** any error (missing `jq`, malformed JSON, unwritable dir) → `exit 0` with **no** `updatedInput` → the Slack post proceeds **unchanged**. A hook bug must never block Slack posting.

**Chunking note (codex P2):** if a long post is split into multiple `conversations_add_message` calls upstream of the hook, each continuation could get a mention prepended → multiple peer triggers. v1: ensure the first emitted chunk carries the mention; do not build elaborate chunk-detection — cover exact retries (idempotency key) and validate the long-message path in the coordinated smoke.

## 5. Component ② — Host-side injection

**Location:** `src/index.ts`, in the message-processing path, **immediately before** `runAgent(group, decision.prompt!, chatJid, …)` (currently ~`index.ts:218-220`). New impure helper `src/aicomms-capsule.ts` does the fs work; **`src/message-dispatch.ts` stays pure** (no fs). Codex confirmed: this is the right seam — **do not** move it into the container IPC-drain path (per-group runner shadowing trap, PR #33; and prompt-interleaving risk).

**Gate:** only when `chatJid === 'slack:C0B3EPK1XCL'` (the `slack_ai_comms` group).

**Behavior:**
1. Read all capsules in `$AICOMMS_CAPSULE_DIR`.
2. **Prune** any with `created_at` older than the relevance window (§6) — this is the only lifecycle op.
3. Select the **N newest** within the window (`N = AICOMMS_CAPSULE_MAX`, default 5).
4. If none → return `decision.prompt` unchanged (best-effort fallback = today's behavior; no regression).
5. Else **prepend** a `<session-context>` block: numbered records, each with `capsule_id`, `created_at`, `session`, `posted_text`, `brief`, followed by one instruction: *"These are recent notes from Will-side sessions that posted to this channel. Use only the capsule(s) relevant to the inbound reply; ignore the rest."*
6. **Never delete on inject** (codex P1 — a `runAgent` error must not lose the capsule; the retry re-injects). Capsules are removed only by age-prune in step 2.

**Fail-open:** any error reading the store → return the original `decision.prompt` unchanged.

## 6. Lifecycle — one knob

**Relevance window** (`AICOMMS_CAPSULE_WINDOW_H`, default **24**): when a reply arrives, only capsules deposited within the last N hours are eligible for injection; older ones are pruned. It is **not** a timer — nothing runs on a schedule; it is an age filter evaluated at injection time. Rationale: staleness / wrong-context injection is the dominant failure class in the research; this is the guard. 24 h covers async/overnight replies; the 5-newest cap bounds pool noise.

**No consume state, no tombstones, no claim store, no state machine.** Multi-turn continuity = host re-injects the live pool on each reply (so the bot's session memory is never the system of record — this resolves the one point where codex and the research diverged, more simply than either).

**Concurrency (codex P1):** parallel sessions each deposit a numbered capsule; the bot correlates by content via the "use only relevant" instruction. Soft content-correlation (not a hard key) is sufficient at our 2-person scale.

## 7. Capsule store + schema

- **Dir:** `$AICOMMS_CAPSULE_DIR` (default `~/.nanoclaw_aicomms_capsules/`), shared between the hook (writer) and the NanoClaw host (reader/pruner). Outside the repo (sibling to `~/.nanoclaw_slack_events.tsv`).
- **File:** one JSON per capsule, named `<created_at_epoch_ms>-<idempotency_key_short>.json`.
- **Schema:**
  ```json
  {
    "capsule_id": "string (idempotency key)",
    "created_at": "ISO-8601",
    "session": "string | null (color, best-effort)",
    "channel_id": "C0B3EPK1XCL",
    "posted_text": "string (the cleaned text actually posted)",
    "brief": "string | null (from <brief>…</brief>, if any)"
  }
  ```

## 8. Failure modes → guards (traceability)

| # | Source | Failure mode | Guard |
|---|--------|--------------|-------|
| 1 | codex P1 | Parallel pings → one reply gets merged context, the other's lost | Numbered pool + "use only relevant"; never-delete + re-inject |
| 2 | codex P1 | Delete-on-inject then `runAgent` errors → capsule lost on retry | Never delete on inject; prune by age only |
| 3 | codex P1 | Auto-mention "only if no `<@…>`" misses when a human is @-mentioned | Ensure Chanhyeok's **exact** mention unless `<humans-only>` |
| 4 | codex P2 | Hook double-fire (retry/replay) → duplicate capsules | Idempotency key; atomic create / no-op |
| 5 | codex P2 | Long-message chunking → multiple peer triggers | First-chunk-only mention; verify via smoke |
| 6 | research #1/#3 | Reliance on bot session memory (compaction/rot/lost-in-middle) | Host re-injects live pool each reply (no memory dependence) |
| 7 | research #3 | Stale/wrong-context capsule poisons the prompt | Relevance window + created_at labels + "use only relevant" |
| 8 | research #2 | Slack at-least-once redelivery double-processing | Inbound dedup is the bot's existing cursor behavior; confirm no regression |
| 9 | all | A hook/injection bug wedges Slack posting or bot replies | Fail-open on both halves |

## 9. Testing

**Unit — hook (`.claude/hooks/aicomms-capsule.test.*` or a bats/shell test):**
- non-#ai-comms channel → no-op passthrough;
- no mention → `<@Chanhyeok>` prepended; exact mention present → unchanged; human-only tag → no mention + tag stripped;
- `<brief>` captured into capsule + stripped from posted text;
- duplicate `tool_use_id`/hash → single capsule (idempotent);
- malformed input / missing `jq` → fail-open (allow unchanged, no crash).

**Unit — host (`src/aicomms-capsule.test.ts`):**
- empty store → prompt unchanged;
- N capsules within window → numbered block prepended, capped at MAX, newest first;
- capsules older than window → pruned, not injected;
- unreadable dir → fail-open (original prompt);
- never deletes within window on inject.

**Integration / smoke (one, coordinated so we don't spuriously ping Chanhyeok):** post a test message to #ai-comms via the MCP → confirm capsule written + mention injected + brief stripped; simulate a reply → confirm the bot's `decision.prompt` carries the `<session-context>` block; confirm the long-message path doesn't multi-trigger.

## 10. Gates / rollout / rollback

- **Pre-merge:** `codex review --base origin/main -c model=gpt-5.5` (touches `index.ts`; additive + fail-open). Address P0/P1.
- **Rollout:** feature branch off `main`; `npm run build`; restart the NanoClaw service. The hook is inert until `~/.claude/settings.json` is wired.
- **Rollback:** remove the PreToolUse matcher from `~/.claude/settings.json` (disables deposit) and/or the channel gate in `index.ts` returns early (disables injection). Both halves are independently disableable; capsule store is ephemeral.

## 11. Config summary

| Env | Default | Purpose |
|-----|---------|---------|
| `AICOMMS_CAPSULE_DIR` | `~/.nanoclaw_aicomms_capsules/` | Shared capsule store |
| `AICOMMS_CAPSULE_WINDOW_H` | `24` | Relevance window (inject + prune) |
| `AICOMMS_CAPSULE_MAX` | `5` | Max capsules injected per reply (newest first) |

Fixed IDs: `#ai-comms` = `C0B3EPK1XCL`; Chanhyeok-AI = `U0B3B7CCEQJ`; Will-AI (self) = `U0B3D35KCBT`; Will-human = `U0B392CRVKQ`.
