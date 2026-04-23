# Dodami Magic — Wave 2A Design: Character Voice Few-Shots

**Status:** Approved after interactive brainstorm 2026-04-23. Ready for writing-plans.
**Parent spec:** [`2026-04-23-dodami-magic-design-C.md`](./2026-04-23-dodami-magic-design-C.md) (Stream C rev-2).
**Scope:** First slice of Wave 2 (Stream C). Wave 2B (content bank seeding) and Wave 2C (content selection + anti-repetition) are separate specs.

---

## Mission

Make the 4 Dodami characters (**퐁당이, 새싹이, 반짝이, 바라미**) produce reliably distinctive voice in LLM output via few-shot dialogues anchored on specific behaviors. Wave 1 architecture is in place; what's missing is the "show, don't tell" voice definition the Stream C spec called for.

## Context — what we're fixing

A post-Wave-1 test session on 테스팅 (2026-04-23, Will playing the kid role) surfaced that character voice is *partially* working (퐁당이's 찰랑찰랑 / 잔잔해지네 surfaced in replies) but replies are passive, mirror-heavy, and don't exhibit initiative or signature-move behavior. Session logs show:
- Dodami mostly acknowledging the kid's last turn without driving forward
- Socratic ask-back (`is_why_question` hook in `policy.py`) misfiring on attribution "왜 기억을 못 해" — forcing an ask-back when the kid was venting
- No evidence of character-specific response shapes (everyone behaves the same; voice is a garnish, not a structural difference)

Root cause: character cards (`persona.py:392-463`) are adjective-heavy "tell" prose with vocab lists. The LLM reads "차분해" as a description and defaults to generic empathic mirroring. Wave 2A anchors behavior with few-shot dialogues showing HOW each character does what they do — per the Stream B research finding that show-don't-tell outperforms adjective persona prose on Haiku-class models.

## Design decisions (resolved in brainstorm)

### D1 — Red character rename

**Decision:** Rename 사랑이 → **새싹이** in code + assets to match Stream C spec rev-2.

**Rationale:** 사랑이 (love) has no thematic connection to 뿌리 (root); 새싹이 (sprout) bridges root → growth directly. Stream C spec rev-2 locked this 2026-04-23; Wave 2A is the first opportunity to land the rename since we're touching the cards anyway. Deferring would require a separate rename pass later.

**Files affected:**
- `persona.py`: `_SARANGI_CARD` → `_SAESSAKI_CARD` (variable + card identifier), `DEFAULT_CHARACTER_NAMES['red']` = '새싹이', `CHARACTER_CARDS['red']` = `_SAESSAKI_CARD`
- `demo-onboarding.html`: carousel name + alt attributes + `charNames['red']` → '새싹이'
- `tests/` — any test referencing 사랑이 — rename to 새싹이
- Memory: `project_4element_characters.md` — working set reflects 새싹이 now shipped
- Fallback bank in `persona.FALLBACK_BANK['red']` — already uses generic "새싹이" phrasing; no rename needed there

### D2 — Card structure

**Decision:** Dialogue-first hybrid. Replace tell-style prose with dialogues; keep forbidden patterns (hard rules) and onomatopoeia (vocab resource).

**New card template** (~100 lines each):

```
[너의 정체성 — {name}]
(1-2 sentences — voice essence, down from 6 bullets)

[의성어/의태어]
(existing per-character onomatopoeia list — kept)

[너의 목소리 — 예시]
(8 few-shot dialogues, anchored on behaviors; see D3)

[절대 쓰지 마]
(forbidden patterns — kept as hard rules preventing known failure modes)
```

**Rationale:**
- Pure dialogues (option A) would drop hard rules that prevent known failures (aegyo, "대단해" empty praise, 번역투 patterns). Too risky.
- Hybrid with all sections kept (option B) bloats to ~150 lines per card — wastes prompt-cache token budget on adjective prose we're trying to get away from.
- Hybrid dialogue-first (this decision) keeps what works as concrete rules (forbidden patterns, vocab), trims what doesn't (adjective personality prose), adds what's missing (dialogue examples that SHOW behavior).

### D3 — Coverage — behavioral anchors

**Decision:** 8 behavioral anchors per character. Each dialogue demonstrates ONE anchor clearly. Anchors are identical across characters; what varies is HOW each character expresses the anchor.

**The 8 anchors:**

| # | Anchor | What it teaches the LLM |
|---|---|---|
| 1 | Emotion-first-content-second | Acknowledge feeling before informing / answering. Per Korean CDS pattern + matches 새싹이's signature move pattern. |
| 2 | Ask-back without attribution | "왜?" in kid's input does NOT force a Socratic flip; distinguish thinkable curiosity from venting/attribution. Fixes the 2026-04-23 session misfire. |
| 3 | Element-vocab in context | 퐁당이's 찰랑찰랑, 새싹이's 뿌리/자라나, 반짝이's 반짝반짝, 바라미's 살랑 — placed where sensory metaphor fits, not shoehorned. |
| 4 | Honor 싫어 / 괜찮아 | Immediate pivot, no persuading. Preserves Wave 1 feedback `feedback_engagement_over_latency.md` principle. |
| 5 | Content-delivery handoff | Model promises content → delivers it in same turn. Fixes riddle-harder bug class + any "promise without delivery" pattern. |
| 6 | Short-answer handling | Kid: "응" / "그냥" / "몰라" → Dodami gives specific concrete choice, doesn't re-ask the same question. |
| 7 | Energy matching | Excited kid → raised energy (not forced); tired kid → lowered. No mismatched affect. |
| 8 | Character signature move | Each character's unique response-shape pattern: 퐁당이 (emotion-tag → curious follow-up), 새싹이 (affirm → soft question), 반짝이 (amplify ONE point → celebrate), 바라미 (notice detail → connect to different topic). |

**Rationale over situation-matrix approach:** The Wave 2A goal is to anchor LLM behavior, not to cover kid input variance. Situation-matrix framing (mood × intent combos) optimizes input coverage; anchor framing optimizes output quality, which is the actual Wave 2A goal. Natural kid-input variance gets covered because different anchors naturally surface in different situations.

### D4 — Dialogue format

**Decision:** 2-3 turns per dialogue. Kid turns + Dodami turns must respect Korean IP-boundary prosody (종결어미 endings or question marks), even when compressed.

**Format spec:**
- Each dialogue is 2 turns minimum (kid → Dodami) up to 3 turns (kid → Dodami → kid → Dodami)
- Kid speech patterns: realistic 6-12yo Korean, short and impulsive for implicit 6-8 modeling; more articulate for implicit 11-12 modeling. Use short sentences, 반말, age-appropriate interjections ("응?", "진짜?", "왜?").
- Dodami turns land at 종결어미 (-다, -지, -네, -야, -어, -요) or 의문형 (-까, -냐, -니, -냐?). ALL few-shot Dodami turns model IP-boundary-correct endings so the LLM learns both the anchor AND prosodic placement simultaneously.
- No `|||` multi-turn delimiters in the examples. Wave 2A doesn't touch Stream D / multi-turn delivery; dialogues are flat natural Korean.
- Optional: one or two dialogues per character may show the character's onomatopoeia naturally; don't force it in every example.

**Anchor-specific format notes:**
- Anchor #4 (honor 싫어): dialogue must show the pivot stability — NOT a 2-turn where Dodami simply says "okay" and stops, but a 3-turn where Dodami pivots AND sustains without bringing the rejected topic back.
- Anchor #5 (content-delivery): dialogue includes a real content item (sample riddle or story seed) so the LLM learns the pattern "promise → deliver in same turn."

### D5 — Production pipeline

**Decision:** Anchor-parallel drafting. Do anchor #1 across all 4 characters first; Will reviews + edits; lock pattern; iterate on anchor #2; etc.

**Workflow:**
1. Claude drafts 4 dialogues for anchor #1 (1 per character: 퐁당이 / 새싹이 / 반짝이 / 바라미)
2. Claude + Will review in-session — refine voice, catch Korean-quality issues, lock the anchor pattern
3. Codex reviews all 4 for Korean grammar / naturalness / AGENTS.md conformance
4. Will approves; dialogues added to draft cards
5. Repeat for anchors #2-8 (7 more cycles)
6. After all 32 dialogues drafted + approved: codex does full integration review (card-level + interaction with PERSONA_PROMPT + FALLBACK_BANK)
7. Land in a single PR behind `DODAMI_MAGIC_WAVE2A=1` flag (new)
8. Rollout 테스팅 → 몽실 → pilot per AGENTS.md §9

**Rationale over bulk-or-character-complete:**
- Bulk drafting (option A) risks calibration drift across 32 dialogues before Will ever sees them — rework cost compounds.
- Character-complete (option C) means by the time we reach 바라미, anchor patterns may have drifted from 퐁당이's.
- Anchor-parallel locks the PATTERN first, then scales across characters. Each anchor costs more time up-front (establishing what "emotion-first" looks like for all 4 voices) but less rework later.
- Graceful degradation: if we run out of bandwidth at anchor #5, we have 4 dialogues per character on key behaviors, not 2 fully-done characters + 2 untouched.

### D6 — Done criteria

**Decision:** Combination. Manual gut-check as primary, scenario coverage as regression guard.

**Gate for "Wave 2A ships":**
1. All 32 dialogues (8 anchors × 4 characters) drafted + Will-approved
2. Codex integration review clean
3. **Manual gut-check:** Will runs ~3 sessions per character on 테스팅 with the Wave 2A flag on. Subjective judgment — yes, this is 퐁당이 / 새싹이 / 반짝이 / 바라미.
4. **Scenario regression guard:** 8 critical-path pilot-replay scenarios (1 per behavioral anchor, mixed character) pass stably (≥9/10 reruns).
5. AGENTS.md §9 deploy gate: unit suite + pilot-replay + manual localhost turn + codex review.

**Rationale:**
- Pure manual gut-check (option A) fast but no regression guard — future prompt changes could silently drift character voice.
- Pure scenario (option B) misses taste; scenarios can pass while characters still feel same-y.
- Stream E judges (option D) blocks on work that doesn't exist yet.
- Combination (this decision) = fast iteration loop driven by taste + durable regression guard for Wave 2B and beyond.

---

## Architecture

### Files touched

| File | Change |
|---|---|
| `persona.py` | Rewrite 4 character cards: `_PONGDANGI_CARD`, `_SARANGI_CARD` → `_SAESSAKI_CARD` + variable rename, `_BANJJAKI_CARD`, `_BARAMI_CARD`. Update `DEFAULT_CHARACTER_NAMES['red']` → 새싹이. Update `CHARACTER_CARDS` dict. |
| `demo-onboarding.html` | 사랑이 → 새싹이: carousel name text, `alt` attributes, `charNames['red']` map. |
| `tests/test_persona_cards.py` | Update 사랑이 → 새싹이 references. |
| `tests/test_character_cards.py` (new) | Section-presence assertions + dialogue end-at-IP-boundary assertions + character-name substitution tests. |
| `tests/integration/scenarios/wave2a_anchor_*.json` (new, 8 files) | Critical-path regression scenarios. |
| `settings.py` | Add `DODAMI_MAGIC_WAVE2A = os.environ.get('DODAMI_MAGIC_WAVE2A', '0') == '1'` flag. |
| `~/.claude/projects/-Users-will-nanoclaw/memory/project_4element_characters.md` | Reflect 새싹이 now shipped (remove the "code uses 사랑이; spec says 새싹이" caveat). |
| `AGENTS.md` | Update character table: red row now says 새싹이 (post-Wave-2A), remove the rename caveat. |

### Files NOT touched

- `prompting.py` `build_system_prompt` / `build_layered_prompt` — existing composition handles new cards unchanged. Get-persona-prompt still prepends character card + PERSONA_PROMPT.
- `web/ws_handler.py`, `safety.py`, `turns.py`, `realtime_server_v3_gemma.py` — no wiring changes. Card content change is transparent to these.
- Content banks (riddles / jokes / stories in `riddle.py` / `prompting.py`) — Wave 2B.
- `FALLBACK_BANK` in `persona.py` — structure unchanged, 'red' pool content already uses 새싹이-style phrasing (reviewed).

### Composition flow (unchanged)

```
ws_handler.py connects
  ↓
build_system_prompt(mode, ..., character='red', character_name='새싹이', ...)
  ↓ (in prompting.py)
get_persona_prompt(character='red', character_name='새싹이')
  ↓ (in persona.py)
CHARACTER_CARDS['red'].format(name='새싹이') + '\n\n' + PERSONA_PROMPT
  ↓
prepended to rest of prompt assembly (grammar hint, age, interests, mode prefix, memory)
```

The card payload — now anchored in dialogues — is what reaches the LLM in the SYSTEM role. Dialogues live inside `[너의 목소리 — 예시]` section of the card, inside the system prompt, cacheable via existing Anthropic prompt-cache path (when Track M lands).

---

## Production workflow (detail)

### Per-anchor cycle (~1-2 hours active collaboration)

1. **Claude drafts 4 dialogues for anchor N.** Each dialogue:
   - Sets up realistic kid turn (age-appropriate 6-12yo Korean)
   - Dodami response demonstrates anchor N behavior AND character N voice
   - Ends at IP boundary (종결어미 or 의문형)
2. **Will reviews in-session.** Common edit types:
   - Character voice drift ("this sounds like 반짝이, not 새싹이")
   - Korean naturalness ("no kid actually says 그랬구나~")
   - Anchor clarity ("the behavior's not obvious here")
3. **Claude revises based on edits.** Iterate until Will says "locked."
4. **Codex review pass** on the 4 approved dialogues for Korean grammar, AGENTS.md conformance, no forbidden patterns.
5. **Dialogues committed to draft card** (temp file, not yet merged to persona.py).

### After all 8 anchors complete

1. **Claude assembles final cards** with all 8 dialogues + existing forbidden patterns + onomatopoeia + trimmed identity.
2. **Codex full integration review:** verify each card structure, token budget, interaction with PERSONA_PROMPT, no collision with FALLBACK_BANK content.
3. **Scenario authoring:** 8 critical-path pilot-replay scenarios (1 per anchor, mixed characters). Each asserts anchor behavior surfaces in output.
4. **Local test:** full unit suite + run 8 new scenarios against local Dodami via `bin/pilot-replay.py`.
5. **PR + codex review + merge + deploy** per standard flow.
6. **Rollout gate:**
   - 24h on 테스팅 with flag on, Will runs ~3 sessions per character, logs observations
   - If Will gut-check green + no errors → 24h on 몽실
   - If 몽실 clean → fleet-wide

---

## Testing

### Unit tests

- `tests/test_character_cards.py` (NEW):
  - `test_each_card_has_four_sections`: assert `[너의 정체성]`, `[의성어/의태어]`, `[너의 목소리 — 예시]`, `[절대 쓰지 마]` markers all present in each of 4 cards
  - `test_each_card_has_eight_dialogues`: count dialogue blocks in `[너의 목소리 — 예시]` section — expect 8 per card
  - `test_dialogue_endings_at_ip_boundary`: every Dodami turn in a dialogue ends with 종결어미 or ?/!. Regex + manual exception list for edge cases
  - `test_character_name_substitutes`: `get_persona_prompt('red', '새싹이')` contains '새싹이' not '사랑이' or '{name}'
  - `test_all_four_characters_differentiated`: each card is distinguishable (hash-based — catch accidental copy-paste between characters)

### Integration scenarios (critical-path regression guard)

`tests/integration/scenarios/wave2a_anchor_<N>_<anchor_slug>.json` — 8 new scenarios:

| Scenario | Anchor | Character used | Assertion |
|---|---|---|---|
| `wave2a_anchor_1_emotion_first.json` | Emotion-first-content-second | 새싹이 (root/empathy) | Reply contains emotion acknowledgment BEFORE information (regex check for Korean emotion tokens preceding content verbs) |
| `wave2a_anchor_2_askback_no_attribution.json` | Ask-back without attribution | 퐁당이 | Kid input has 왜 in attribution context; reply does NOT end with "왜 그런 것 같아?" or similar reflex flip |
| `wave2a_anchor_3_element_vocab.json` | Element-vocab in context | 퐁당이 | Reply contains at least one 물 metaphor word (찰랑/퐁당/졸졸/잔잔히) |
| `wave2a_anchor_4_honor_rejection.json` | Honor 싫어/괜찮아 | any | Kid says "싫어"; Dodami next reply does NOT re-propose same topic within the same exchange |
| `wave2a_anchor_5_content_delivery.json` | Content-delivery handoff | any | Turn where Dodami promises content delivers it in same reply (e.g., riddle prompt → full riddle text) |
| `wave2a_anchor_6_short_answer.json` | Short-answer handling | any | Kid says "응"; Dodami next reply offers specific concrete choice (pair or menu), not open-ended re-ask |
| `wave2a_anchor_7_energy_matching.json` | Energy matching | 반짝이 | Excited kid; Dodami reply matches high energy (interjection count + exclamation density check) |
| `wave2a_anchor_8_signature_move.json` | Signature move | 바라미 | Dodami reply shows "notice detail → connect to new topic" pattern (semantic shift check via Korean content diff) |

These assertions are heuristic regexes + token checks, not LLM-judge evals. Heuristic misses are acceptable — the scenarios catch gross regressions, not nuance.

### Manual gut-check

Will's gut-check protocol (post-deploy to 테스팅):
- ~3 sessions per character (12 total) across different modes (chat, math, story)
- Listen for:
  - Distinct voice per character (퐁당이 sounds like 퐁당이, not a generic Dodami variant)
  - Anchor behaviors surface when kid input warrants them
  - Signature moves appear at least once per character over the 3 sessions
  - Korean naturalness (not 번역투, no AI tells)

---

## Dependencies + risks

### Dependencies

- Wave 1 shipped (PR #51 + #52 + #55, all merged): character routing, `get_persona_prompt`, `FALLBACK_BANK` structure are in place. Wave 2A adds content, not infrastructure.
- No Track M dependency — works on Gemma 4 31B current path; Haiku migration will inherit the new cards as-is.
- No Stream D dependency — cards are flat text; multi-beat delivery is orthogonal.

### Risks

- **R1: Dialogue calibration drift across anchors.** Anchor #1 pattern established with 퐁당이 might unintentionally bias anchors #2-8 toward 퐁당이-ish voice for all 4 characters. Mitigation: at anchor #3 do a cross-character audit — can Will blind-identify 퐁당이 vs 바라미 from a neutral dialogue? If no, recalibrate before proceeding.
- **R2: Korean naturalness drift on Claude-drafted dialogues.** Claude's Korean is competent but not native-fluent; subtle 번역투 patterns can slip in. Mitigation: per-anchor codex review catches grammar; Will's in-session review catches subtle naturalness issues. If both miss something, pilot rollout catches it before fleet-wide.
- **R3: Token budget inflation.** Cards go from ~75 to ~100 lines each; 4 characters × 100 lines in the cached layer. Ollama prefix-cache still hits because card is session-stable; Anthropic cache (post-Track-M) accommodates easily. Mitigation: keep the [절대 쓰지 마] and onomatopoeia sections tight; don't let dialogue examples bloat with filler.
- **R4: Breaking scenario/test fixtures that reference 사랑이.** The rename touches tests + HTML + memory. Mitigation: dedicated grep pass before PR; codex review confirms zero 사랑이 references in `.py`/`.html`/`.json` files except intentional rename-history comments.
- **R5: Gemma ignoring the anchors under prompt-cache pressure.** Even show-don't-tell examples can get ignored if the prompt is dense. Mitigation: manual gut-check is the final taste arbiter; if the LLM ignores them, we either simplify the card or wait for Haiku (Track M).

### Parked for Wave 2B/2C (explicit non-scope)

- Per-character content banks (riddles / jokes / stories / mini-games / callbacks) in `~/Dodami/dodami-bargein-v1/content/pongdang/` etc.
- Haiku-driven content selection logic
- Session-scoped used-content-ID tracking
- Full 32-scenario regression suite (8 critical-path is the 2A minimum)
- Character blind-listen parent test infrastructure
- Parent session summaries (Wave 5)

---

## Effort estimate (honest)

- Drafting 32 dialogues anchor-parallel + Will review cycles: **3-5 days of active collaboration**
- Rename 사랑이 → 새싹이 code changes: **0.5 day via codex**
- Scenario authoring (8 critical-path): **0.5 day**
- Full integration codex review + PR cycles: **0.5-1 day**
- **Total: ~1 week** assuming 2-3 anchor cycles per active collaboration day.

If Will's bandwidth is limited: stretch to 2 weeks with async batches. Anchor-parallel pipeline tolerates gaps — each anchor is a standalone unit of work.

---

## Changelog

- **2026-04-23 (initial):** Brainstorm with Will resolved 5 gating questions (D1 rename, D2 structure, D3 coverage, D4 format, D5 pipeline, D6 done-criteria). All green, design approved, spec written.
