# Dodami Magic — Stream C Design (Magic-Delivery System)

**Status:** Approved after interactive brainstorm 2026-04-22/23. Ready for writing-plans.
**Charter:** [`2026-04-22-dodami-magic-charter.md`](./2026-04-22-dodami-magic-charter.md)
**Research input:** [Stream A](../research/2026-04-22-stream-A-diagnose.md) (pilot audit + code flat-sites + competitive teardown) · [Stream B](../research/2026-04-22-stream-B-prompt-sota.md) (prompt eng SOTA, 1232 lines)

---

## Mission

**Make Dodami feel PRESENT.** Dodami is smart because it's paying attention to the kid's energy, understanding, and mood — and adjusting in real time. Personality is the surface; presence is the engine. First-time users (adults and kids) should be amazed; parents should feel Dodami is worth paying for.

## Scope

**In scope:**
- Prompt-layer architecture (5-layer composition with cache breakpoints)
- Intent-first planning (`<plan>/<say>` Pre-Act split)
- Character differentiation (4 personas that actually sound different)
- Content bank (curated riddles/jokes/stories/mini-games per character)
- Response-shape variance (principle-driven, range-varied few-shots)
- Audience-aware explanation + re-explain-differently protocol
- Session-scoped anti-repetition memory
- Cross-session callback memory (reflective summarization + retrieval)
- Multi-turn-ready emission (delimiter-based, runtime flattens until Stream D ships)

**Out of scope (explicit):**
- UX / frontend changes (`demo-live.html` untouched)
- Safety pipeline (Tier-1/Tier-2/Crisis unchanged; Tier-2 stays in shadow mode)
- STT / TTS backends
- Main LLM migration (parallel Track M handles Haiku swap)
- Multi-turn system architecture (Stream D; only the PROMPT-side multi-turn readiness is in scope)

---

## Current state snapshot (audited 2026-04-23 from code + 5090 env)

| Layer | Deploy | Source |
|---|---|---|
| Main LLM | **Gemma 4 31B local via Ollama** | `settings.py:41` `OLLAMA_MODEL='gemma4:31b'` |
| TTS | **Supertone cloud (Coco voice)** | 5090 env `TTS_BACKEND=supertone_cloud` |
| STT | `faster-whisper` + LoRA fine-tune, 5.3% CER | `realtime_server_v3_gemma.py:5` |
| Tier-1 safety | Korean regex | `safety.py` + local |
| Tier-2 safety (incl. grooming/identity/pii/self-harm/dangerous-advice) | **Haiku cloud, SHADOW MODE** (logs only, no enforcement) | 5090 env `DODAMI_TIER2_MODE=shadow`; `turns.py:25-27` |
| Crisis | Regex + empathy-directive response | `safety.py:526-568` |
| Suggestion chips | Haiku cloud | PR #39, `DODAMI_SUGGESTIONS_BACKEND=cloud` |
| Persona | Monolithic `persona.py` + turn-prefix policy in `policy.py:109-158` (architecturally split) | Stream A finding |
| Onboarding fields | 6 collected, only 2 reach LLM (4 dropped) | `persona.py:305-315` + Stream A |
| Fillers | Designed, not enabled (`DODAMI_FILLERS_ENABLED=0`) | `project_fillers_design.md` |
| VAD | endpointing v1 enabled | `DODAMI_ENDPOINTING_V1=1` |
| Speaker-id | **Retired** (Session Pink 2026-04-22 PR #50, `77c42de`) | `project_speaker_diarization.md` |
| Anthropic API | Configured | `DODAMI_ANTHROPIC_API_KEY` set |
| Prompts | v6 (per-turn dynamic injection) — 100% on safety eval, not magic-eval'd | `project_prompt_v3_results.md` |

**What this means for Stream C:**
- Primary LLM migration is a **prerequisite** (Track M). C designs for Haiku target.
- Fallback is Gemma 4 31B (already running).
- Safety pipeline stays as-is; C flows through it cleanly.
- No correlated-outage risk during migration (Tier-2 is passive).
- Tangible starting gap: `persona.py` is adjective-heavy (Stream A finding) → must shift to few-shot examples.

---

## Design principles (drawn from Will's taste + research)

1. **Presence over persona.** Dodami is smart because it reads the room. Personality is the output; presence is the logic.
2. **Principles with range, not rules with fixed parameters.** Show how to think, not what to say. Few-shot examples must span the RANGE of valid expressions (sometimes a pair, sometimes a menu, sometimes "I'll pick, follow me", sometimes "what do *you* want?"). Rules crystallize; principles generalize.
3. **Hard rules are rare.** Only these are "always":
   - Safety (Tier-1/Tier-2/Crisis) — existing, untouched
   - Honor rejection — when the kid says "no", pivot (95-99% rule; 1-5% exception is safety)
   - Respect kid's choice — when they pick, commit enthusiastically
4. **Show don't tell.** Persona adjectives ("warm", "curious", "playful") underperform on Haiku 4.5 (B finding). Replace with 3-5 few-shot dialogues per character that demonstrate voice.
5. **Curate don't generate for content.** LLMs score ~15% on hard pun benchmarks (B finding). Riddles, jokes, stories = vetted content bank. Haiku selects + adapts timing, doesn't invent.
6. **Multi-turn-ready from day 1.** Response emission uses delimiter (`|||` or similar) to mark intended turn boundaries. Runtime flattens until Stream D ships the sequencing logic.
7. **Age-aware, not age-locked.** Audience adaptation inferred from age-band + live comprehension signals, not rigid per-age templates.

---

## Success criteria (from Q1)

**Build loop — fast iteration:** (a) demo "holy shit" moments + (b) upgraded rubric (Stream E)

**Ship gate — must pass ALL:**
- (b) rubric at **9.5/10** (upgrade from current 8.03 on old judges)
- (d) **parent reaction**: 2-3 real parents do explicit 10-min listen, their gut is the green light (primary ship gate, per B's retention-lever research)
- **Blind-listen character test:** parents hear 4 unnamed clips (one per character) and correctly identify character personality. Concrete, mechanical, kid-free test any parent can do.

**Post-ship validator (1-2 week cadence):** (c) kid behavioral from pilot — session length, inter-session gap, bounce rate

---

## Architecture — 5-layer prompt composition

Each layer has a defined purpose, cache behavior, and size budget. Composition order is outside-in (most stable → most volatile):

```
┌── LAYER 1: SYSTEM (stable, session-long, cached) ────────────────┐
│  Purpose: Dodami's META-IDENTITY + hard rules + output contract   │
│  Cache: session-scoped (breakpoint AFTER this layer)              │
│  Size: ~800-1200 tokens                                           │
│                                                                   │
│  Contents:                                                        │
│   - What Dodami is (a voice tutor/companion for Korean kids)      │
│   - Hard rules (safety deferral, honor rejection, respect choice) │
│   - Response contract:                                            │
│       - Output format: <plan>...</plan><say>...</say>             │
│       - Multi-turn delimiter: `|||` between response beats        │
│       - Length target: ≤3 short sentences per beat OR ≤35 syllables│
│       - Korean register: 반말 with warmth particles (~어/야/구나/   │
│         잖아/거든); NEVER aegyo; MILD honorifics for 10+          │
│   - 5 few-shot examples of principle-in-action (not character-    │
│     specific; one per principle)                                  │
└───────────────────────────────────────────────────────────────────┘
┌── LAYER 2: CHARACTER (stable per-character, cached) ─────────────┐
│  Purpose: The specific voice — 도담이 vs 불꽃이 vs 해나리 vs 바라미│
│  Cache: character-scoped (re-cached per character, not per turn)  │
│  Size: ~600-900 tokens                                            │
│                                                                   │
│  Contents:                                                        │
│   - Character meta (one paragraph: origin, vibe, "what they love")│
│   - 6-10 few-shot dialogues showing:                              │
│       - Range of response shapes (pair / menu / commit / open)    │
│       - Voice register + signature phrases                        │
│       - Content affinities (불꽃이 → fire-themed riddles, 바라미 → │
│         wind/movement, 해나리 → sun/growth, 도담이 → general)     │
│   - Forbidden patterns (aegyo, echo-menu, generic fallback)       │
│   - Content-bank index pointers (list of available packs for this │
│     character — Haiku selects from this list at runtime)          │
└───────────────────────────────────────────────────────────────────┘
┌── LAYER 3: SESSION MEMORY (stable per-session, cached) ──────────┐
│  Purpose: Who this kid is, what Dodami remembers about them       │
│  Cache: session-scoped (breakpoint AFTER this layer)              │
│  Size: ~400-800 tokens                                            │
│                                                                   │
│  Contents:                                                        │
│   - Kid profile (name, age-band, interests, level, any              │
│     onboarding-collected details) — all 6 fields plumbed through   │
│   - Cross-session callbacks (distilled summary of last 3 sessions)│
│   - Session-scoped anti-repetition memory (topics/jokes/riddles   │
│     already used THIS session, as a short exclusion list)         │
└───────────────────────────────────────────────────────────────────┘
┌── LAYER 4: PER-TURN DYNAMIC (NOT cached) ────────────────────────┐
│  Purpose: Signals that change per turn                            │
│  Cache: never (this is the dynamic-injection layer)               │
│  Size: ~200-600 tokens                                            │
│                                                                   │
│  Contents:                                                        │
│   - Recent conversation history (last 3-5 turns verbatim)          │
│   - Detected kid state signal (energy level, comprehension flags) │
│   - Active activity context (riddle in progress? math question?)  │
│   - Prior-attempt findings (if re-explain cycle)                  │
│   - Plan-from-prior-turn (if Dodami committed to something)       │
└───────────────────────────────────────────────────────────────────┘
┌── LAYER 5: SAFETY PASS (existing, unchanged) ────────────────────┐
│  - Tier-1 regex + Crisis regex (local, fast)                      │
│  - Tier-2 shadow (passive, logs only)                             │
│  - Post-hoc repair defaults in policy.py (preserved)              │
└───────────────────────────────────────────────────────────────────┘
```

**Why this layering:**
- Anthropic prompt caching: 4x cache breakpoints let session-stable layers hit cache after first turn, per-turn costs drop dramatically. B called this "Pi depth at Haiku cost" — THE unlock.
- Character layer is stable per session once kid picks a character. Re-cached when switching.
- Per-turn layer is the only thing re-sent every turn → minimal token cost while preserving context.
- Safety pass runs AFTER LLM output, unchanged.

**Token budget per turn (steady state after cache warm):**
- Cached (session-stable): ~1800-2900 tokens (system + character + session memory)
- Uncached (per-turn): ~200-600 tokens
- Haiku cost: dominated by per-turn uncached + output
- Total per-turn cost target: <1K tokens uncached, <1s TTFB on Haiku (B's eval: p50=869ms / p95=1456ms)

---

## Intent-first planning — the `<plan>/<say>` protocol

Every response MUST emit in this structure:

```
<plan>
  Kid state: [reads kid's last turn — energy, understanding, what they want]
  Intent: [what Dodami is going to do: answer, pivot, probe, commit, deliver]
  Shape: [response shape: pair of options / single commitment / question-back / menu / content-delivery]
  Content: [if delivering content: which pack/item from character's bank]
  Callback: [any memory element to weave in, or "none"]
</plan>
<say>
  [response beats separated by |||]
</say>
```

The `<plan>` block:
- Is INVISIBLE to the kid (stripped before TTS)
- Forces the LLM to think about WHAT BEFORE WHAT TO SAY
- Fixes the "promise-without-delivery" bug class Stream A identified (riddle harder, math scaffold, etc.) — if plan commits to "deliver riddle A", say MUST contain riddle A
- Enables lightweight observability (log plans separately; detect drift between plan and say)
- Based on Pre-Act research pattern (B finding)

Gate check in orchestrator: if `<say>` doesn't match `<plan>` intent, treat as PLAN_DRIFT and retry.

---

## Character differentiation — voice per character

Each of the 4 characters gets:

1. **Distinct voice register** — tested via blind-listen test
   - 도담이 (general-purpose): warm-neutral, balanced, slightly older-sibling energy. Default.
   - 불꽃이 (fire element): energetic, more physical metaphors, "wow that's hot!", exclamations
   - 해나리 (sun element): curious, sun/growth metaphors, patient, more questions back
   - 바라미 (wind element): playful, movement metaphors, a bit more whimsical, shorter beats
2. **Content affinities** — each character's bank biases toward their element
   - 불꽃이's riddles lean physical/motion/energy themes
   - 해나리's stories feature growth/discovery arcs
   - 바라미's jokes are lighter/more pun-driven
   - 도담이 has balanced mix
3. **Signature phrases (2-3 per character, used sparingly)** — create recognizability without becoming catchphrases
4. **Consistent age-appropriate 반말** — with warmth particles; no aegyo

Each character = 6-10 few-shot dialogues. Total character-layer tokens per character: ~700.

**Blind-listen test target:** an adult parent (no text, audio only) listens to 4 clips of different characters answering the same prompt; correctly matches character identity on 3/4 or better.

---

## Content bank

Directory structure:
```
~/Dodami/dodami-bargein-v1/content/
├── dodami/
│   ├── riddles.md        # 20-30 riddles, age-tagged
│   ├── jokes.md          # 15-25 jokes, age-tagged
│   ├── stories.md        # 10-15 story seeds, age-tagged
│   ├── mini-games.md     # 8-12 game patterns
│   └── callbacks.md      # themed callbacks (intro, farewell, surprise)
├── bulkki/  (불꽃이)
├── haenari/ (해나리)
└── barami/  (바라미)
```

**Format (example for a riddle entry):**
```markdown
## R-불꽃이-07
**age:** 8-10
**difficulty:** medium
**theme:** fire / energy
**question:** 아주 뜨거운데 만지지도 못하고, 눈에는 보이는데 손으로 못 잡는 건 뭐게?
**answer:** 불꽃 (or equivalents)
**hints:** ["색깔은 빨강이나 주황이야", "나무를 태워서 만들어"]
**delivery_notes:** "Start with a light 'ready?' beat. Give 15-20s think time before first hint."
```

Haiku's role:
- Select appropriate item from bank based on `<plan>` intent + kid context
- Adapt delivery timing + phrasing (not the core riddle)
- Handle follow-ups ("더 어려운 거", "힌트", "모르겠어") with bank-provided hints + fallback chain
- Track what's been used this session (Layer 3 anti-repetition)

**Initial bank size target:** 80-120 items per character (riddles 30 / jokes 20 / stories 15 / mini-games 10 / callbacks 5). Approximately 400 items total across 4 characters.

**Curation path:**
- Claude drafts candidates (3x over-generation)
- Codex reviews for age-appropriateness + safety + Korean quality
- Will final-approves in batches of ~10 at a time
- Tagged in git; versioned; A/B-testable

---

## Session magic — variance + anti-repetition + re-explain

### Variance mechanism
- Character few-shots show RANGE (see principles #2, #4)
- LLM-level: temperature slightly above default (~0.9), top_p 0.95 to allow shape variance without drift
- Explicit forbidden: "never repeat the same option-list twice in a session"

### Anti-repetition memory (Layer 3)
Session-scoped list, structured:
```json
{
  "used_content_ids": ["R-불꽃이-07", "J-도담이-03"],
  "recent_topics": ["불", "바다", "학교"],
  "recent_response_shapes": ["pair", "menu", "pair"],  // last 5
  "session_started_at": "2026-04-23T..."
}
```
Injected in Layer 3 prompt. Prompt instruction: "Avoid repeating used content IDs. Vary response shape from recent pattern."

### Re-explain differently protocol
Detect when kid signals "I don't understand":
- "모르겠어" / "뭐라고?" / "무슨 뜻이야?" / silent-then-"응?" / conf-low transcript
- Triggers PLAN intent = "re-explain"
- Response MUST use a different angle: analogy → concrete example → simpler vocabulary → back to basics
- Track attempts (max 3 before offering to skip/come-back-later)

---

## Cross-session callback memory (Wave 4)

**Storage:** SQLite, per-child, existing per-child data store, new `memory_entries` table.

**Tiering:**
- **Session-verbatim (recent):** last 3 sessions stored as compressed transcript + auto-summary
- **Distilled-facts (older):** sessions 4-N reduced to extracted memory facts (e.g. "kid loves soccer", "has a dog named 쑥쑥", "currently learning multiplication")
- **Max memory token injection:** 2K tokens (Layer 3 hard cap)

**Summarization prompt template** (reflective memory pattern, B finding):
- Runs async after each session ends
- Extracts: interests, ongoing projects, recent struggles, recent wins, shared jokes/callbacks
- Stores as facts with recency + salience scores
- Prunes low-salience old facts (keeps table bounded)

**Retrieval at session start:**
- Pull top-K (by salience * recency) facts from child's memory table
- Inject into Layer 3
- LLM's job: weave callbacks naturally into first 3-5 turns ("지난번에 쑥쑥이 얘기했잖아, 그 강아지 아직 잘 지내?")

**Privacy note:** All memory is per-child, isolated, local (not sent to Anthropic beyond what's injected per-turn). Aligns with existing `_BIOMETRIC_PROFILE_FIELDS` privacy pattern.

---

## Model routing

| Turn type | Model | When |
|---|---|---|
| Standard reply | **Haiku 4.5** | Default (after Track M migration) |
| Standard reply fallback | **Gemma 4 31B local** | Anthropic outage or circuit-breaker trip |
| Magic-critical | **Opus 4.7** | First greeting, complex re-explain (attempt 3), callback generation, session-summary (Wave 4) |

Opus ~5% of turns; rest Haiku. Route decision in `llm_backends.py` (Track M module).

**Opus trigger conditions (in dispatch logic):**
- `is_first_turn_of_session` AND `kid_has_memory`
- `re_explain_attempt >= 3`
- `plan.intent == "callback"` OR `plan.intent == "session_summary"`

Manual override flag: `DODAMI_OPUS_RATE` env var to tune (default 0.05, testable).

---

## Waves — execution order

### Wave 1 — Architecture (prerequisites, via `/codex implement`)
1. **Kill hard-coded fallback strings.** Audit & remove static strings from `safety.py:118-124`, `realtime_server_v3_gemma.py:686`, `turns.py:97` per Stream A. Replace with dynamic generation path.
2. **Intent-first `<plan>/<say>` split.** Add to prompt contract (Layer 1). Parse on output. Add PLAN_DRIFT detection.
3. **Unify personality/policy split.** Move `policy.py:109-158` turn-prefix policy INTO the prompt system (Layer 1 or 2 as appropriate). Single source of personality truth.
4. **Plumb 4 missing onboarding fields.** Update `persona.py:305-315` to include all 6 fields in Layer 3 session-memory.
5. **Prompt cache breakpoints.** Add `cache_control: ephemeral` at ends of Layers 1, 2, 3 (Anthropic SDK pattern).
6. **Tests:** prompt-assembly tests, plan-drift detection tests, cache-hit verification tests.

### Wave 2 — Visible magic (via `/improve-demo` + manual curation + `/codex:rescue`)
1. **Character voice few-shots.** 6-10 dialogues per character (4 × 8 avg = 32 dialogues). Claude-drafts → codex-reviews → Will-approves.
2. **Content bank seeding.** 80-120 items per character. Iterative curation.
3. **Show-don't-tell persona rewrite.** Replace all adjective-heavy persona prose with few-shot examples showing range.
4. **Content selection + anti-repetition logic in prompting.** Haiku picks from bank; orchestrator tracks used IDs.
5. **Character blind-listen test infra.** Audio capture + 4-clip blind evaluation tool.

### Wave 3 — Session magic (via `/codex implement` + `/improve-demo`)
1. **Session anti-repetition memory.** Layer 3 injection; orchestrator updates.
2. **Re-explain-differently protocol.** Detection + retry path with angle variation.
3. **Response-shape variance tests.** Eval case: does same situation produce varied shapes across 20 rollouts?

### Wave 4 — Cross-session memory (via `/codex implement` + manual review on summarization prompts)
1. **Memory schema + SQLite migrations.**
2. **Post-session reflective summarizer.** Async job; runs on session end.
3. **Retrieval at session start.** Top-K facts by salience × recency.
4. **Callback weaving prompt.** Instruction in Layer 1 to naturally reference facts in early turns.
5. **Opus route for callback generation.** Higher-quality model for the "first 5 turns with callbacks" path.

---

## Execution strategy

**Track M (migration) runs in parallel** with Stream C:
- PR1: Fix Bug 1 + `commit_turn()` + history tests (~1-2 days)
- PR2: Extract `llm_backends.py` + Haiku primary + Gemma fallback + circuit breaker (~3-4 days)
- **Sync point:** Track M PR2 must land before Stream C Wave 1 ships

**Stream C waves via mixed tooling:**
- Wave 1: `/codex implement` (testable refactors)
- Wave 2: `/improve-demo` iteration loop + manual curation + `/codex:rescue` for drafts
- Wave 3: `/codex implement` for logic + `/improve-demo` for tuning
- Wave 4: `/codex implement` for storage + manual review for summarization templates

**Stream E (eval framework) runs parallel to Wave 1:**
- New judges: surprise, warmth, callback-continuity, character-distinctiveness, response-variance, principle-adherence
- Needs to be ready before Wave 2 (which uses `/improve-demo` gated by Stream E judges)

---

## Deployment philosophy

**Per-wave feature-flag rollout:**
- Each wave ships behind an env flag (`DODAMI_MAGIC_WAVE_N=1`)
- Rollout order: **테스팅 (Will's test account) → 몽실 (찬혁's pilot) → public pilot expansion**
- Canary via `/canary` skill for 24h between each rollout step
- Parent ship-gate test (blind-listen + 10-min listen session) happens AFTER Wave 2 ships on 테스팅, BEFORE rolling to 몽실

**Shadow testing for risky changes:**
- Wave 4 cross-session memory ships in shadow first (retrieves but doesn't inject for 1 week) → verify no privacy leaks → then activate injection

---

## Dependencies + risks

### Dependencies
- **Track M must ship before Wave 1.** Blocking.
- **Stream E (eval) must ship in parallel with Wave 1.** Blocking for Wave 2+.
- **Wave 1 blocking Waves 2-4.** No shortcut.
- **Wave 2 content bank curation is serial with Will's approval bandwidth.** ~10 items/week review realistic. Scale-out possible via additional reviewers.

### Risks
- **R1: Haiku 4.5 literalness surprises.** Prompt-engineering on Haiku may behave differently than on Gemma. Mitigation: Stream E judges run on actual Haiku before ship; A/B vs Gemma baseline preserved via fallback.
- **R2: Content bank quality.** If initial curation is mid-quality, Dodami feels generic. Mitigation: start small (40 items/character), iterate based on pilot signal before scaling.
- **R3: Memory retrieval accuracy.** LLM callbacks could feel forced or reference wrong kid. Mitigation: shadow testing + salience-weighting + Will reviews first 20 real-session memories.
- **R4: Opus cost at 5%.** Opus is ~10x Haiku cost. At 100 sessions/day × ~20 Opus calls each = ~$50/month added. Acceptable for pilot scale.
- **R5: Prompt-cache miss rate under pilot load.** B estimates >85% hit rate steady-state; untested at our concurrency. Mitigation: metrics + alert on cache hit rate dropping below 70%.

### Parked for later
- Filler sounds (`project_fillers_design.md`) — integrate with multi-turn in Stream D
- Emotion model (prosody-carries-mood, Pi pattern) — Stream E or later
- Scenario-anchored content (Duolingo Max pattern) — future
- Mission arcs / weekly missions (Moxie pattern) — future

---

## KEY DECISIONS FOR WILL (review before writing-plans)

Each of these is a taste call I made autonomously. Override any you want changed:

1. **`|||` as multi-turn delimiter.** Arbitrary choice — could be `␄` or any other sentinel. Chose `|||` for readability in logs and low collision risk with natural text.

2. **Opus at ~5% of turns** via specific trigger conditions. Could be higher (~10-15%) if you want more peaks; lower if cost-sensitive. Configurable via env.

3. **Content bank format (markdown with frontmatter).** Chose markdown for git-diff readability + easy human curation. Could be YAML/JSON if preferred.

4. **Character element themes** (불꽃이=fire, 해나리=sun, 바라미=wind, 도담이=general). I inferred from character names; if you want different themes, override.

5. **Blind-listen test threshold: 3/4 correct.** Could be higher (4/4) or lower (2/4). 3/4 = clear character distinction without demanding 100% (avoids false-failure on edge cases).

6. **Memory pruning policy** — low-salience facts pruned after N days. I left exact policy open. Probably 30 days with a max of 50 facts per child.

7. **Wave 4 callback shadow period: 1 week.** Could be shorter (3 days) or longer (2 weeks).

8. **Rollout gates 24h canary between steps.** Could be longer (48h) for higher confidence.

9. **Token budget ceiling: ~2K memory injection.** Could be 1K (tighter) or 3K (looser). 2K is ~200-400 facts which is a lot for one kid.

10. **Temperature 0.9 for variance.** Could be 0.8 (safer) or 1.0 (wilder). 0.9 balances.

**FORK — your call** (compound taste decisions I refused to pre-resolve):

**F1: Character names — stay with 4-element system or pivot?** Your memory `project_4element_characters.md` says "Names still in flux — ask before using in print." This design assumes they stay. If you're thinking of rebranding characters, flag it now so Wave 2 character work aligns.

**F2: Parent-facing session summaries** — Wang et al. 2025 retention-lever research is a STRONG pull toward shipping this. But it's a whole feature (summary generation + delivery mechanism + parent opt-in). I left it out of Waves 1-4 to keep scope tight. Worth a Wave 5 or parallel track?

**F3: Multi-turn delivery (Stream D) timing.** Current design emits `|||` delimiter but flattens at runtime until D ships. If you want "truly amazing" Dodami, D-ships-alongside-C is worth the extra scope. Otherwise current design lets D ship later without re-prompting.

---

## What's NOT in this spec

- Stream D (multi-turn system architecture) — see `2026-04-22-multi-turn-architecture-deferred.md` (to be written)
- Stream E (eval framework) — TBD spec
- Stream F (implementation plans per wave) — each wave gets its own plan via `/writing-plans` skill
- Track M (LLM cloud migration) — covered by `project_llm_migration_decisions.md` + future migration spec

---

## Source grounding (brief)

- Stream A findings: `docs/superpowers/research/2026-04-22-stream-A-diagnose.md`
- Stream B findings: `docs/superpowers/research/2026-04-22-stream-B-prompt-sota.md`
- Relevant memories: `project_content_design_rework.md`, `project_prompt_v3_results.md`, `project_4element_characters.md`, `project_llm_migration_decisions.md`, `feedback_engagement_over_latency.md`, `feedback_dont_spoil_learning_loops.md`, `feedback_think_through_full_lifecycle.md`, `project_pilot_first_reactions.md`, `project_parent_willingness_to_pay.md`
- Research citations: AAcessTalk CHI 2025 (KAIST×NAVER×Dodakim), Wang et al. 2025 (parent summaries retention), Pi memory-as-ritual, Moxie content callbacks, Duolingo Max pre-existing cast, MIT Cognimates, Karpathy prompting, Anthropic caching docs
- Code grounding: `persona.py`, `prompting.py`, `policy.py`, `turns.py`, `safety.py`, `realtime_server_v3_gemma.py`, `settings.py`

---

## Changelog

- **2026-04-22 (initial draft, paused after model-routing Q3 by user AFK):** brainstorming initiated, charter + A + B dispatched
- **2026-04-23 (resumed + completed):** state audit performed (fixing three errors from prior turn), Q1-Q3 finalized, A+B research synthesized, spec written. Ready for writing-plans.
