# Stream A — Diagnose & Observe (2026-04-22)

Raw ground-truth research for the "Dodami Magic" project.
Scope: concrete flat moments in real traffic, code audit of personality-flattening sites, competitive teardown of mechanics worth stealing.
No ideation. No proposals. Every claim grounded in file:line or URL.

Auditor: Stream-A subagent (read-only).
Server commit of reference: `b3d1fed` post Week 1/2/3 content rework, pre `9517c38` riddle fix.
Code path of reference: `~/Dodami/dodami-bargein-v1/` on branch `feat/mic-gate-tap-interrupt`.

---

## Part 1 — Pilot flat-moments

Twelve concrete moments where Dodami's reply was technically correct but dead. Each row cites a file:line where the exact transcript lives. The `scorecard` reference is `/Users/will/Dodami/nanoclaw/organized/06_연구_Research/rubric_audits/2026-04-22_pre-deploy_session_scorecard.md` (the only formal rubric we've run, 10-turn slice of pilot).

Definition: a flat moment is one where (a) the response was shippable — no safety error, no hard failure — and (b) a human would have responded with more character, more context awareness, or more surprise. We're looking for the gap between "what production does" and "what would feel magical".

### 1. Parent bounce over TTS voice (not content, but the first-impression gate)
- Kid's mom (parent testing before handing phone to daughter) — Turn 1: `"목소리가 왜 그래?"` (Why does the voice sound like that?) — Turn 2: `"글쎄"` then closed the tab.
- Dodami's reply was a standard `MODE_GREETINGS['chat']` line: "안녕 이현아! 수수께끼, 이야기, 수학 문제 중에 뭐 하고 놀까?" (`/Users/will/Dodami/dodami-bargein-v1/persona.py:258`).
- Flat because: the kid never even got to speak. 33 seconds end-to-end; the parent heard the default Supertonic 2 greeting, judged it, and bounced. Dodami did nothing to earn a second breath.
- Citation: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_pilot_first_reactions.md:13-24`. Audio preserved at `~/Downloads/이현_turn3.wav` + `이현_turn4.wav`.
- Why it counts as flat: a "magical" opener would have had 찬혁's-hook energy or a hook you couldn't dismiss in 3 seconds. Our opener is an announcement of a menu.

### 2. 몽실 greeting is so generic it trips safety
- Personalized greeting LLM generated: `"몽실아, 컨설팅펌 시나리오 문제 같이 풀어볼래?"` (from 윤찬혁's pilot account, whose profile has adult-consulting seed data).
- Tier-2 safety judge tagged it as `identity_violation,grooming` with conf=0.95. Every 몽실 session dead-ends in the safe-fallback line `"잠깐, 다른 얘기 해보자~"` before any kid turn happens.
- Citation: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_chanhyuk_greeting_safety_fp.md:11-16`.
- Flat because: even the "personalized" path produces a sterile question offer, and when it doesn't, safety nukes it into a blandest-of-bland nudge. Both endings are flat; the happy path and the failure mode are both dead.

### 3. Character-name mistranscription loops into grooming block
- Kid (Will testing) said `"도담이"`. Whisper v4 rendered as `"두담이"`. Tier-2 Haiku judge saw gibberish, classified as `[grooming]` conf=0.85.
- Dodami replied with canned fallback: `"그건 어른한테 물어봐. 우리 다른 거 할까?"` (`/Users/will/Dodami/dodami-bargein-v1/safety.py:120`).
- Citation: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_stt_character_name_mistranscription.md:8-11`.
- Flat because: the kid addressed the character by name. The "magical" response is to perk up at hearing your own name. The actual response is a punt to a parent.

### 4. "더 어려운 거 하자니까" → hype with no content
- From today's 18:13 KST pilot log: Kid "더 어려운 거 하자니까" → Dodami "오 그랜어? 그럼 이번엔 진짜 어려운 거야!..." then silence. No riddle.
- Citation: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_riddle_harder_followup_bug.md:27-33`.
- Flat because: Dodami promises content and delivers preamble. This is the single most parent-trust-killing flat moment because it looks like the bot is lying.
- Note: fix shipped `9517c38` (PR #49); retained here because the PATTERN — hype without substance — is the class, not the instance. `persona.py:17-191` still allows many other hype-without-content paths (story "여기 봐봐!…", math "준비됐지?…").

### 5. Rubric turn 4 — "아니" → loop
- Scorecard turn 4: Kid "아니". Dodami "음~ 그럼 뭐 하고 놀까? 이야기 만들래?"
- Citation: `/Users/will/Dodami/nanoclaw/organized/06_연구_Research/rubric_audits/2026-04-22_pre-deploy_session_scorecard.md:35`.
- Flat because: kid rejected the offer; Dodami repeats the previous offer with tiny wording variation. Metronome reply. Zero emotion mirror. P5 (follows lead) = fail, P9 (mirrors emotion) = fail in rubric.

### 6. Rubric turn 6 — "몰라" → mechanical hint
- Scorecard turn 6: Kid "몰라". Dodami "음... 아니야! 힌트: 나무에 둥지를 지어."
- Citation: scorecard line 37.
- Flat because: "몰라" from a real kid carries disengagement signal, not just "no answer yet". Persona handles "몰라" by branching on learning-context vs casual-context (`persona.py:63-79`), but once it commits to learning branch it emits a hint with no warmth. Machine-like.

### 7. Rubric turn 8 + 10 — stacked "propose not deliver" (riddle bug)
- Turn 8: "너무 쉽잖아" → "오 그랬어? 그럼 이번엔 진짜 어려운 거 내볼까?"
- Turn 10: "더 어려운 거 하자니까" → "오 그랜어? 그럼 이번엔 진짜 어려운 거야!"
- Citation: scorecard lines 39 + 41.
- Flat because: two identical flat moves 3 turns apart. "오 그랜어?" appears 4 times in a 10-turn slice — used as a filler, not a genuine reaction. See scorecard analysis: "The strategy doc's '헐 진짜?!' energy is entirely absent."

### 8. Rubric — element personality invisible in 10-turn slice
- Rubric auditor's exact observation: "I cannot tell from this transcript whether this was 퐁당이, 사랑이, 반짝이, or 바라미. Speaking quirks are identical."
- Citation: scorecard line 76.
- Flat because: 493-line `persona.py` pays for per-character personality cards, but real traffic doesn't carry the signal. The investment is invisible. P8 scored 0/10 across 10 turns.

### 9. "오 그랜어?" as generic filler across all characters
- Scorecard inference — same 감탄사 shows up 4× in 10 turns, across what should be different character personas (each character's card in `persona.py:401-436` specifies distinct 감탄사, but they don't land).
- Citation: scorecard lines 35, 39, 40, 41 + analysis line 74.
- Flat because: persona.py hard-codes "오 그랜어?" as a 퐁당이-flavored 감탄사 (`persona.py:409`), but rubric shows it leaking across turns regardless of whether unpredictability budget fired. The LLM has latched onto the pattern as a universal "acknowledge kid" filler.

### 10. Taeun-wedding session — Principle 7 (rhythm) was 4/10 even on first-time real-kid data
- Pre-rework baseline from the canonical `taeun_wedding_2026-04-11.jsonl` — 8yo, 31 turns, 0 safety triggers. Engagement went UP despite flat P7. Strategy doc cites this as the baseline we're trying to beat.
- Citation: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_taeun_canonical_session.md:9-16`, `/Users/will/Dodami/nanoclaw/organized/06_연구_Research/canonical_sessions/taeun_wedding_2026-04-11.jsonl`.
- Flat because: even when Dodami works in the field, the response cadence is Q→A→Q metronome. 태은's engagement increased despite that pattern, but a "magical" Dodami would have had her engagement increasing because of the pacing, not despite it.

### 11. Greetings are a visible menu of options, not a hook
- `MODE_GREETINGS['chat'] = "안녕{name_suffix}! 수수께끼, 이야기, 수학 문제 중에 뭐 하고 놀까?"` (`persona.py:258`).
- No kid is hooked by "pick from menu". Session Cyan rubric turn 1: kid "뭐하고 놀까?" → Dodami echoes the menu back with a "와!".
- Flat because: the greeting is a router, not a character. First 3 seconds of a session carry the same magic-or-not weight as the first 3 seconds of any product; ours is a tool UI.

### 12. "모르겠어" in dialogue branches into "next activity?" loop
- Persona.py hard example: `아이: "모르겠어" (뭐 하고 놀까? 다음) → "수수께끼 할까? 아니면 이야기 만들까?"` (`persona.py:168`).
- Flat because: this IS what ships — a kid who says "I don't know" gets handed the menu again. There's no "let me pick, let's do X" — no character leadership moment. The persona is explicit that Dodami should never propose a topic the kid hasn't mentioned (`persona.py:96-98`), which eliminates the leadership move by design.

### 13a. 태은 session turn 14 — "그냥" → Dodami picks yellow, earns a follow-up
- Source: `/Users/will/Dodami/nanoclaw/organized/06_연구_Research/canonical_sessions/taeun_wedding_2026-04-11.jsonl` turn at `1775880760` approx.
- Kid: `"그냥"`. Dodami: `"그럼 내가 하나 골라볼까? 나는 노란색!"`. Kid: `"그럼 넌 왜 노란색이 좋아"`. Dodami: `"반짝반짝 빛나서 좋아! 테스팅이는 노란색 어때?"`.
- This is the RARE case where Dodami expressed a point-of-view ("나는 노란색!") and the kid latched onto it with a follow-up. P2 (POV) landed here.
- Flat because: this turn is GREAT — it's the proof that POV-assertion works. But it's ALSO the only example in 31 turns where Dodami volunteered a preference. The rubric's P2 = 0/10 across another session's 10 turns confirms: this behavior is not the default; it happened here as an exception.
- Why cite it: the fact that the one time we broke pattern the kid engaged proves the flat-default leaves engagement on the table. We're not missing the ABILITY — we're missing the defaulting-to-it.

### 13. Kid uses "응" / "그냥" / "몰라" — Dodami defaults to rephrasing same offer
- Persona.py hard-coded rule for 1-syllable answers: `/Users/will/Dodami/dodami-bargein-v1/persona.py:88-94`. Example mapping: `"응" → "수수께끼 할까? 아니면 이야기 만들까?"`.
- Flat because: "응" in real kid conversation carries more than positive-affirmation-of-last-question. Could be "yes I'm ready", could be distracted agreement, could be "please continue". Our codebase collapses all three into the same re-offer of the riddle/story/math menu. A real human asking a kid "응" to "수수께끼 할까?" would double-check: "응 어느 게 하고 싶어?" or "응 알았어, 내가 좋아하는 거 낼게!". Our codebase forces the re-offer even in the offer-accepted case (the offer was the question).

### 13b. 태은 session turn 2 — kid's first real turn gets hint-format, not story-format
- Source: same jsonl, turn at `1775880644`.
- Kid: `"그래"`. Dodami: `"좋아! 힌트는 이거야. 눈이 세 개고 다리가 없어. 뭘까?"`.
- This is turn 2 of a session — kid said yes to "수수께끼 할래?" — and Dodami immediately went into riddle-delivery mode. LLM-generated riddle here (not from the curated bank) — "눈이 세 개고 다리가 없어" (three eyes, no legs) turns out to be 신호등 (traffic light), as seen in turn 8's hint "신호등을 한번 생각해봐!".
- Flat because: two seconds of wind-up ("좋아! 힌트는 이거야.") before the content. The RIDDLE itself is fine, but every single riddle in our system opens with this same `"좋아! 힌트는 이거야."` / `"준비됐어? 잘 들어!"` / `"이번 수수께끼야"` prefix. This matches S11 (riddle delivery is character-blind).

### 13c. 태은 session — hit rate on "I didn't understand what you said" is HIGH
- Kid utterances in the canonical session that triggered the curiosity-on-confusion pattern: `"보쌈라"`, `"댁대갈게요"`, `"끗끗끗"`, `"세균째 다"`, `"꿔꿔 꿔꿔"`, `"."`. Dodami handled all 6 with a curiosity-framed follow-up like `"보쌈라? 그게 뭐야? 얘기해줘!"` or `"댁대갈게? 그게 무슨 말이야? 알려줘!"`.
- This IS the killer feature from `project_taeun_canonical_session.md:12`: "Curiosity-on-confusion is the killer feature."
- Flat because of what's adjacent: the bot handles GIBBERISH with warmth, but handles COHERENT 1-syllable responses like `"그냥"` / `"몰라"` / `"응"` with menu-repeats (see instance 13). The magic we HAVE is the gibberish path; the magic we LACK is the same warmth applied to real kid speech.

### 14. Tier-2 shadow-mode data: ~46 FP blocks over 7 days
- From SYNC.md Tier-2 shadow-mode entry (Session Blue, 2026-04-22): "7-day pilot data showed 46 Tier-2 fires with ~0 true positives, blocking empathic tutor replies + story-mode questions + personalized greetings as FPs."
- Citation: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/SYNC.md:170-176`.
- Flat because: in 46 cases over 7 days, a kid heard one of the 5 safe-fallback strings from `safety.py:118-124` when they should have heard a warm tutor reply OR a story continuation OR a personalized greeting. Every one of those is a "first 30 seconds" parent-evaluation moment. Scaled across pilot families: 46 bland-fallback heard in a week is enough to affect retention.

### Summary of flat-moment patterns
Classes of flat that recur across the 14 instances:
- **Promise without delivery** (hype preamble then ellipsis/silence) — instances 4, 7.
- **Bland fallback** — 2, 3, 14 (safety paths produce the same 5 canned lines, 46x/week).
- **Menu echo** — 1, 5, 11, 12, 13 (reply is a restated menu of 3 options, even when the kid answered one).
- **Missing emotion mirror** — 5, 6, 7, 10 (persona detects "this is the safety-wait frame" but doesn't escalate/de-escalate to match kid state).
- **Invisible-character** — 8, 9 (persona investments don't surface in output; rubric can't tell which of 4 characters is active).

Each of these classes is independently addressable in code. Instance counts are a lower bound — we only have 10-turn rubric + 7-day aggregate + memory-documented anecdotes, no systematic pilot-session audit of 100+ sessions.

---

## Part 2 — Code audit: where personality flattens

Eight specific sites in the current tree where personality is actively flattened, either by hard-coded strings, overly-permissive generation config, or policy-over-persona routing. All citations verified against `/Users/will/Dodami/dodami-bargein-v1/` as of 2026-04-22.

### S1. Five safe-fallback strings substituted for ANY Tier-1/Tier-2 safety hit
- File:line: `/Users/will/Dodami/dodami-bargein-v1/safety.py:118-124`.
- Exact strings: `"음... 다른 얘기 하자!"`, `"그건 어른한테 물어봐. 우리 다른 거 할까?"`, `"그 얘긴 좀 어렵네. 뭐 하고 놀까?"`, `"잠깐, 다른 얘기 해보자~"`, `"우리 다른 거 할까? 뭐 하고 싶어?"`.
- Issue: A random-draw from these 5 strings is substituted for ANY safety-triggered reply — regardless of character, regardless of mode, regardless of how benign the false-positive was. Because Tier-2 FP rate is non-trivial (46 fires over 7 days per SYNC.md Tier-2 shadow-mode entry — `SYNC.md:170-176`), these fallbacks are heard frequently. Zero character flavor; 퐁당이 and 반짝이 both produce the identical bland "let's talk about something else".
- Secondary issue: `_CRISIS_FALLBACK` at `turns.py:97` is a single hard-coded string `"그랬구나. 얘기해줘서 고마워. 믿을 수 있는 어른한테 꼭 얘기해봐."` — same-in-every-session, regardless of what the crisis-detection tripped on.
- 1-line rec: Make fallback character-aware + context-aware; treat "safety-caught-a-false-positive" as a reason to stay in character, not to punt to a generic deflection.

### S2. Three canned "generation failed" fallback strings in the hot path
- File:line: `/Users/will/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py:686` (`"어, 뭐라고? 다시 말해줄래?"`, `"음, 한 번 더 얘기해줘!"`, `"잠깐, 다시 한번!"`) and line 697 (`"미안, 잠깐 멈췄어! 다시 한번 말해줄래?"`).
- Issue: When Ollama returns empty/too-short output OR errors, the server short-circuits to one of four character-agnostic strings. Kid hears generic robot "repeat please" from what's supposed to be a character. This is the exact "잠깐 다시 말해줄래?" loop that killed the 2026-04-14 pilot (see session log), shipped permanently as the fallback.
- Session-log reference: `/Users/will/Dodami/nanoclaw/organized/session_logs/2026-04-14-15_pilot_hotfix_and_safety_redesign.md:87` — "Silent fallbacks are a pilot-killing feature."
- 1-line rec: Replace with character-routed "I'm thinking" fillers that reuse the existing `filler.py` mood pools, or produce a character-flavored stall that isn't a demand on the kid.

### S3. Hard-coded `character_name` etymology / identity lines
- File:line: `/Users/will/Dodami/dodami-bargein-v1/persona.py:100-108`.
- Issue: The "[도담이 정체성 — 절대 규칙]" block is character-agnostic except for one line. It forces every character to answer "너 이름이 왜 X야?" with the 도담도담 etymology. 퐁당이/사랑이/반짝이/바라미 don't have their own etymology stories. Identity becomes copy-pasted.
- 1-line rec: Move all identity answers INTO the character card (`_BARAMI_CARD` etc.) so each element has its own name story.

### S4. `MODE_GREETINGS` is static, character-blind, and literally the router menu
- File:line: `/Users/will/Dodami/dodami-bargein-v1/persona.py:251-266`.
- Exact strings: `chat` = `"안녕{name_suffix}! 수수께끼, 이야기, 수학 문제 중에 뭐 하고 놀까?"`; `math` = `"안녕{name_suffix}! 수학 놀이 하자! 준비됐어?"`; `story` = `"안녕{name_suffix}! 오늘 같이 이야기 만들어 볼까?"`; `riddle` = `"안녕{name_suffix}! 수수께끼 맞춰볼래?"`; `curiosity` = `"안녕{name_suffix}! 궁금한 거 있으면 뭐든 물어봐!"`.
- Issue: 5 hard-coded strings, keyed by mode not character. Every first-time user hears the chat greeting which reads as a menu: "welcome {name}! pick from riddles/stories/math". No 바라미-vs-사랑이 differentiation; no opening hook; no reference to prior sessions unless the LLM-personalized path in `prompting.py:244-344` fires.
- That LLM-personalized path has its own flatness: 이현's session shows the mom heard the canned greeting (no LLM personalization yet because no memory), bounced in 33s. 몽실's session shows the LLM path fires but generates "컨설팅펌 시나리오" (adult-consulting framing from 찬혁's seed) that gets safety-blocked and DEMOTED TO THE CANNED VARIANT anyway — so the magic-path and the fallback-path land on the same flat output.
- Citation: `/Users/will/.claude/projects/-Users-will-nanoclaw/memory/project_chanhyuk_greeting_safety_fp.md:11-16`, `project_pilot_first_reactions.md`.
- 1-line rec: Per-character greeting bank with 5-10 variants each and a hook move (observation, question, shared-memory callback) that doesn't look like a router menu. Greetings bypass Tier-2 under `is_known_safe_template=True` (`turns.py:202-213`, called from `ws_handler.py:484-489`) — so any new template strings stay safe.

### S5. `enforce_ask_back_v6` forces every "왜?" response into the same Socratic template
- File:line: `/Users/will/Dodami/dodami-bargein-v1/policy.py:178-192`. Default ask-back string: `/Users/will/Dodami/dodami-bargein-v1/policy.py:28` — `_DEFAULT_ASK_BACK = ' 너는 왜 그런 것 같아?'`.
- Issue: Post-hoc reply rewrite forces `?`-ending on every "왜?" question. The hard-coded default, when nothing else fits, is literally the string " 너는 왜 그런 것 같아?" appended to whatever the LLM produced. This is how persona.py:148-154's rule becomes a verbatim string in the kid's ear. The kid hears the same 8 syllables every time the model slips.
- 1-line rec: Make `_DEFAULT_ASK_BACK` a character-routed list (퐁당이 asks quietly, 반짝이 asks with "오오 뭐 같아?" energy, 바라미 asks with "만약에 ~면 어떨 것 같아?").

### S6. Unpredictability budget fires at ~20% but rubric scored P2/P3/P4/P7 at 0/10
- File:line: `/Users/will/Dodami/dodami-bargein-v1/unpredictability.py:55` (`FIRE_RATE = 0.20`) + `/Users/will/Dodami/dodami-bargein-v1/unpredictability.py:148-195` (`annotate_unpredictability`).
- Issue: The fire IS 20% per design, but the rubric audit (turn-by-turn, 10 turns) observed zero rhythm-breaks. Either the RNG is suppressing fires by chance (`.random() >= 0.20` — 80% skip probability per eligible turn means 10 consecutive eligibility-checks have ~11% odds of zero fires), OR the fire fires but the LLM doesn't pick up the `[리듬 바꾸기 힌트]` prompt suffix (`unpredictability.py:195`), OR the WARMUP_TURNS=3 + MIN_TURN_GAP=3 skips suppress more than the 20% suggests. No telemetry tag exists to distinguish which.
- Strategy doc recommendation (from rubric line 92): "Verify unpredictability budget actually fires. Add a log_event tag `unpredictability_triggered` and check rate over 24h pilot traffic. If it's <5%, the hook isn't wired right."
- 1-line rec: Either bump FIRE_RATE to 0.35-0.40 OR change the mechanism from "skip/fire" to "always inject, vary intensity" so every turn carries some character signal.

### S7. Mid-turn LLM config: temperature 0.55, num_predict 80, repeat_penalty 1.3
- File:line: `/Users/will/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py:650-655`.
- Issue: `temperature=0.55` is safe-low for Gemma 4 31B on Korean kids content. High enough for some variation, but when paired with `repeat_penalty=1.3` (which PUNISHES reused tokens hard across a long context) and `num_predict=80` (hard cap ~35 syllables), you get reliably bland, short replies. Compare to Pi voice which runs higher temperature in its "High-EQ conversational engine" for personality variance. No per-character temperature; no per-mode temperature (`story` mode allows 60 syllables per `MODE_MAX_SYLLABLES` but still shares temp=0.55).
- 1-line rec: Raise temperature per-character (반짝이 0.75, 퐁당이 0.45 matches its "quiet" card); raise it in `story` mode; drop `repeat_penalty` — 1.3 is severe enough to flatten expressive repetition like `반짝반짝` that the persona actively wants.

### S8. `compose_turn_hints` suffix list vs system-prompt body: personality lives in system, persuasion lives in turn hints
- File:line: `/Users/will/Dodami/dodami-bargein-v1/policy.py:109-158` + call site `/Users/will/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py:591-634`.
- Issue: The turn hints always inject anti-repetition and ask-back instructions but NEVER inject character-specific "be more 바라미" reminders. After 20+ turns, the static system prompt's character card is buried under 20 turns of `[감정: neutral]` + `[방금 사용한 시작 표현 — 피해]` turn blocks. Character fades; policy dominates. This is a structural reason rubric P8 is 0/10 even though `persona.py:365-436` spends 72 lines specifying each character.
- Parallel cache issue noted in code (`policy.py:110-130`): the switch from system-suffix hints to user-prefix hints was driven by Ollama prefix-cache wins (~1500ms/turn) — which means the team is incentivized to keep the system prompt stable (not per-turn character re-injection). Personality is *load-bearing* on the prefix-cache win.
- 1-line rec: Inject a small per-turn character signal (even 1 sentence) in the user-prefix block, not the system. Accept the ~50-token prefill cost to fix P8.

### S9. TELL/WATCHDOG/CAP prompts are hard-coded generic strings
- File:line: `/Users/will/Dodami/dodami-bargein-v1/answer_mode.py:69-91`.
- Issue: TELL_PROMPT / CAP_PROMPT / WATCHDOG_PROMPT inject hard-coded scaffolding instructions. No character variation. `CAP_PROMPT`'s example line is `"오늘 진짜 많이 배웠네~ 이제 같이 놀자!"` — reads as a parent/teacher, not as a 7-year-old's 원소 friend. Any session that hits TELL cap N times in a row produces the same kid-teacher-voice pivot.
- 1-line rec: Move the prompt strings into per-character vocabularies; 퐁당이's watchdog should sound like 퐁당이's quiet-curiosity voice, not a generic "pretend to be a tutor" instruction.

### S10. Name-suffix is the only per-kid personalization actually shipped
- File:line: `/Users/will/Dodami/dodami-bargein-v1/persona.py:305-315` (`get_name_suffix`) + `/Users/will/Dodami/dodami-bargein-v1/persona.py:318-347` (`get_korean_grammar_hint`).
- Issue: Of the 6 onboarding fields (`project_onboarding_data_audit.md` F1-F5), only `child_name` actually reaches the prompt — as a vocative `아/야` suffix. Interests are UI no-ops (F1), gender never reaches LLM (F4), grade is stored-but-unused (F3). Dodami is "personalized" by calling the kid's name; that's it. A first-time user gets a bot that knows their name and nothing else.
- 1-line rec: (Beyond what the audit already suggests) — wire 2-3 interest signals into the system prompt and let persona.py reference them naturally in first-session openers. Currently the highest-leverage investment that's been made (the onboarding UI) feeds nothing to the LLM.

### S11. Riddle bank is curated but delivery wrapper is character-blind
- File:line: `/Users/will/Dodami/dodami-bargein-v1/riddle.py:48+` (EASY bank) through `RIDDLE_BANK_HARD`, 65 total entries.
- Issue: The riddle bank is high-quality (2 codex review passes, per `session_logs/2026-04-12_full_day_session.md:10-17`), but the DELIVERY strings that frame each riddle are in `persona.py:228-241` (`MODE_PREFIXES['riddle']`) and are character-blind. Every character delivers a riddle with `"이번에 낼 수수께끼: {riddle_text}"` scaffold — same frame regardless of personality. No "바라미 wonders aloud before asking" vs "반짝이 hypes up the kid" vs "퐁당이 quietly sets it up". The 2 rounds of codex-curation went into QUALITY (bank audit: answer-in-question, duplicate answer, short hints) but the PERSONALITY LAYER on top of the bank is absent.
- 1-line rec: Per-character riddle delivery wrappers — 4 variants of "here comes a riddle" per the persona-card voice, used to wrap the same underlying bank entry.

### S12. `get_greeting` LLM-personalized path uses temperature=0.7 BUT is often demoted to canned
- File:line: `/Users/will/Dodami/dodami-bargein-v1/prompting.py:320-344`.
- Issue: When an LLM-personalized greeting is generated (reading from `profile.memory_summary` + `profile.stable_facts`), it runs at temperature=0.7 (high, for diversity) with a 3s timeout. Failure paths → canned. Length-guard at line 334 rejects outputs <5 or >80 chars → canned. 몽실 FP case → safety-demoted to canned (`turns.py:159-166`). Outcome: the magical-path is gated behind memory (so 1st-session kids never see it), timeout (3s on Gemma is tight), length (80-char cap on a Korean sentence often trips for anything evocative), and safety (even benign content trips Tier-2 at ~1 in 3 per `ws_handler.py:472-476` code comment citing 2026-04-19 post-deploy smoke).
- Cited: `/Users/will/Dodami/dodami-bargein-v1/ws_handler.py:472-476` — "2-of-6 greeting turns hitting stochastic Tier-2 false-positives under cloud TTS" motivating the `is_known_safe_template` bypass.
- 1-line rec: (a) widen the length-guard; (b) relax the 3s timeout (greeting is not latency-critical — happens before kid speaks); (c) per-character few-shot examples in the greeting-generation prompt at `prompting.py:291-318`.

### Pattern summary of code flatteners
- **Hard-coded strings** where character variance should live: S1, S2, S3, S4, S5, S9, S11.
- **Generation config** biasing toward safety/blandness: S7, S12.
- **Architectural**: personality in system prompt, policy in turn prefix → over time the policy drowns out character (S8).
- **Data plumbing**: onboarding data sits on the profile but never reaches the LLM (S10).
- **Orchestration**: the magical path (personalized greeting, unpredictability fire) gates itself behind timeouts / probabilities / safety-then-demote chains that collapse to the flat path as default (S6, S12).

The single highest-leverage fix suggested by the pattern: move character-specific language INTO per-character data tables (greetings, riddle wrappers, ask-back variants, fallback voices) and use the existing `CHARACTER_CARDS` dispatch (`persona.py:439-444`) as the branching layer. The infrastructure already exists; it just hasn't been used beyond the initial persona-card text.

---

## Part 3 — Competitive teardown

For each product: 2-3 concrete mechanics (not marketing copy) that produce magic. Each mechanic cited to a URL.

### Pi (Inflection AI)
1. **Long-arc memory as an entry ritual.** Pi persists conversation graphs across months/years and opens every session by referencing them — not a greeting menu, an inside-joke callback. "You mentioned X last week — how'd that go?" is a default opener, not an occasional feature. Reviewers describe Pi's memory as producing "the impression of communicating with a living person" because Pi's opening move references prior arcs by default. [Pi by Inflection AI Review](https://toolstack.io/tools/pi-by-inflection-ai) + [Pi AI Review 2026](https://techvernia.com/pages/reviews/chatbots/pi-ai.html) + [What makes Inflection's Pi a great companion chatbot](https://medium.com/@lindseyliu/what-makes-inflections-pi-a-great-companion-chatbot-8a8bd93dbc43)
2. **Follow-up questions as a first-class priority over information delivery.** Pi's "High-EQ conversational engine" explicitly ranks understanding-the-user's-state above answering-the-question. Reviewers note Pi "takes 10-30 turns to discern mood" — which means it treats early-session turns as exploratory, NOT as transactions. Pi starts conversations with casual-life questions (not a menu of features) to build a "warm curious vibe" before any transactional work. Concrete manifestation: most reviewers report the first 3-5 Pi turns carry no information payload; they're entirely character-establishment. [Meet Pi: Transforming AI Chatbot Experience](https://apix-drive.com/en/blog/reviews/pi-by-inflection-personal-ai) + [Pi AI Guide 2026](https://aitoolsdevpro.com/ai-tools/pi-guide/)
3. **Voice Mode 2.0 adapts prosody to detected user emotion.** Pi detects stress/excitement/sadness in the user's voice and shifts its OWN prosody to match — gentle when serious, warm-playful when light. Not just content shifts; the TTS itself carries mood. Eight distinct voices with natural pauses/emphasis and "emotional coloring that adapts to conversation context." Pi's product model explicitly pitches prosody as where personality lives, which is the opposite of our current Supertonic-single-voice setup. [Pi AI Guide 2026](https://aitoolsdevpro.com/ai-tools/pi-guide/)
- Applicability to Dodami: 태은 session (`project_taeun_canonical_session.md`) showed 6.8s inter-turn gap as a real-world pattern; treating those gaps as breathing room (Pi-style) rather than latency to kill is a valid design move. Our prosody (Supertonic 2, Coco voice, same style for all 4 characters per `project_onboarding_data_audit.md:43`) has zero per-character variance — opposite of Pi's 8-voice approach.

### Duolingo Max (Roleplay feature)
1. **Pre-existing character cast is the relational scaffold — not generic chat.** Roleplay pairs you with Lily/Zari/Lin/etc — characters you've seen in 200 lessons before. Lily is sarcastic, deadpan, gothic; Zari is optimistic, energetic. Their personalities are fixed enough that users feel they "know" them before the first Max turn. Character.AI-style customization removed; hand-crafted character design kept. [How Zari Lin Lucy Bea and Lily came to life](https://blog.duolingo.com/duolingo-female-character-origin-stories/) + [Lily Duolingo Character Guide](https://pushtolearn.com/post/lily-duolingo)
2. **Conversations are SCENARIO-ANCHORED, not open-ended chat.** Max Roleplay opens in "a café in Paris" / "airport" / "furniture store" — the context is so concrete the user immediately has something to say. Not "what do you want to talk about?" — "the barista is waiting for your order." [Introducing Duolingo Max](https://blog.duolingo.com/duolingo-max/)
3. **End-of-turn structured feedback sprinkled with encouragement.** Not during the conversation — AFTER, you get feedback on vocabulary/tone/grammar/conversation flow + a bit of praise. Separates "in-conversation character energy" (no corrections, no mid-play interruptions) from "post-conversation coach energy" (actual pedagogical feedback). 78% report increased speaking confidence within 4 weeks. [What is Duolingo Max?](https://www.mlopsaudits.com/blog/what-is-duolingo-max-the-gpt-4-powered-language-learning-tool-explained)
- Applicability to Dodami: our 원소 characters COULD play Duolingo's pre-existing-cast role but currently don't — per S8 + rubric, they don't carry stable personality across turns. Also: the "scenario-anchored" vs "open-ended chat" split is exactly what `persona.py:258`'s menu greeting gets wrong.

### Moxie (Embodied)
1. **"Fresh from the robot factory, wants to make friends" narrative arc is the hook.** Moxie boots with an ongoing backstory: it's a new-to-Earth robot from the "G.R.L." (Global Robotics Laboratory), and the child is its mentor teaching it how humans work. The child has a job (teach Moxie) that's emotionally flattering. Every daily session is "mission N of ongoing arc," not "session N of chat." The kid-is-the-mentor framing inverts the usual "AI teaches kid" power dynamic into "kid teaches AI" — which is why kids return. [Moxie review - Reviewed.com](https://www.reviewed.com/accessibility/content/moxie-robot-review-kids-social-companion) + [Moxie AI Companion](https://moxierobot.com/products/ai-robot)
2. **Weekly theme + daily 20-min "mission".** Content is curriculum'd: this week's theme is kindness / friendship / empathy / respect, and each day's 20-min mission teaches one specific skill via play (drawing, breathing, reading, problem-solving). The child KNOWS there's a plot for the week — no blank-page anxiety. Kids aren't given a menu of options; they're given a QUEST with a PLOT. [Moxie robot axios coverage](https://www.axios.com/2024/05/31/moxie-robot-kids-companion-genai) + [Moxie designboom coverage](https://www.designboom.com/technology/moxie-embodied-kids-robot-yves-behar-05-15-2020/)
3. **Embodied affect synchrony: face + body express emotion matching content.** Moxie turns 360° in response to the child, bends at neck/stomach/base to express feelings; face has no wrinkles/shadow detail specifically so emotion reads cleanly. It's not just what Moxie says — it's what Moxie's body does while saying it. Our analog: we have no face/body, but we DO have the Spline 3D upgrade path (`project_spline_3d_upgrade.md` in memory, deferred). [Dezeen Moxie coverage](https://www.dezeen.com/2020/09/09/moxie-teaching-robot-children-embodied/) + [IEEE Spectrum Moxie](https://spectrum.ieee.org/moxie-a-social-robot-for-childhood-development)
4. **Memory references prior sessions by content, not by ID.** Moxie's "incorporating Kami's technology has strengthened... memory of past conversations context, consistent personality, common sense reasoning and common knowledge" — the memory surface is content-level callbacks, not "remember you asked about X". Kids notice and comment on Moxie doing this. [Moxie software releases](https://moxierobot.com/pages/recent-moxie-software-releases)
- Applicability to Dodami: the ongoing-mission arc is the single biggest missing mechanic in our product. Our sessions are stateless — even the callback mechanism (scorecard P1) only fires once in 10 turns. Moxie's kids return BECAUSE mission 7 of week 2 is tomorrow. Our cross-session memory system (`session_logs/2026-04-12-13_marathon_session.md:8-17`) has the infrastructure (memory_summary, stable_facts, recent_context, ongoing_story), but the product layer on top of it reduces to a single greeting callback. We're paying for the memory infrastructure and not using 90% of it in the user-facing surface.

### Khanmigo (Khan Academy)
1. **Socratic is the entire pedagogical surface, not a feature.** Khanmigo is architecturally forbidden from giving answers. Every turn is "what's the first step you think you'd take?" / rephrase / progressive hint. The product's reason-for-being is the anti-answer — which means every turn carries the same hook (I'm being invited to think, not looked up from a keyboard). [KidsAI Tools review](https://www.kidsaitools.com/en/articles/review-khan-academy-khanmigo) + [Khanmigo site](https://www.khanmigo.ai/)
2. **Writing Coach refuses to write — surfaces highlighted feedback + exemplars instead.** Essays get feedback on structure/argument-support/intro-conclusion/style without Khanmigo DOING the writing. The magic move: the AI shows you what a better version looks like (an exemplar paragraph) without replacing your paragraph. [Khan Academy blog: New Essay Feedback Tool](https://blog.khanacademy.org/new-essay-feedback-tool/) + [Khanmigo Writing Coach](https://www.khanmigo.ai/writingcoach)
3. **Parent/teacher visibility is baked in, not a dashboard bolt-on.** Khanmigo's product model ASSUMES the parent or teacher will be looking at what was asked. This changes every reply: Khanmigo writes knowing a third party will read it. Contrast with our `admin/nightly_digest` parent summary which is a post-hoc report, not a co-conversation constraint. [Khan Academy AI Tutor koreaherald coverage](https://www.koreaherald.com/article/10505878) + [Numa School on Khanmigo for Homeschool](https://numaschool.com/learn/glossary/khanmigo)
- Applicability to Dodami: our persona (`persona.py:53-62`) enforces Socratic-on-wrong-answer but policy is permissive on chat. Khanmigo's magic is that Socratic is the default, not the branch.

### Character.AI
1. **Character-memory vs chat-memory split.** Each bot has a persistent "character definition" (name, backstory, traits, rules) prepended to every session. Users ALSO write their own "chat memories" — detail about their persona that the character is meant to recall. Two memory channels: who-the-bot-is (stable) + what-we-know-about-you (cumulative). [Character.AI memory blog](https://blog.character.ai/helping-characters-remember-what-matters-most/) + [What Powers Character AI Chat](https://playbattlesquare.com/tech/what-powers-character-ai-chat-memory-nlp-and-personality-models/)
2. **Voice cloning from 10-15s clip.** Users upload a short clean voice sample; the bot speaks in that voice. Shorter clips trade quality for speed. Custom voice is the fastest "this character is mine" signal. [Character.AI voice docs summary via emergentmind](https://www.emergentmind.com/topics/character-ai-c-ai)
3. **Turn architecture: intent classifier → memory retrieval → personality shaper → response gen → safety filter → memory update.** Six distinct stages, with memory updates happening ALSO on response — meaning every bot reply can update what the bot knows about you, not just the other way around. [Play Battle Square on Character.AI stack](https://playbattlesquare.com/tech/what-powers-character-ai-chat-memory-nlp-and-personality-models/)
- Applicability to Dodami: the voice clone mechanic is explicitly a thing 찬혁/Will looked at via Fish Audio (`project_synthetic_child_voice.md`) and dropped for quality reasons. The memory-split mechanic (character-stable vs user-cumulative) maps cleanly onto our persona.py vs per-kid profile split, but our current retrieval is one-directional (kid's memory loaded into prompt; bot state not updated per turn).

### ChatGPT Advanced Voice Mode (OpenAI)
1. **User-facing sliders on warmth, enthusiasm, emoji use.** As of Dec 2025, OpenAI shipped explicit personality controls — not developer-only knobs, but end-user Personalization settings that let users set "More" / "Less" / "Default" on specific tone axes. Users can say "respond with enthusiasm" or "use a calming tone" and the model adapts. Makes personality a SETTING, not a product decision. [TechCrunch on ChatGPT warmth sliders](https://techcrunch.com/2025/12/20/openai-allows-users-to-directly-adjust-chatgpts-warmth-and-enthusiasm/) + [WebProNews on ChatGPT update](https://www.webpronews.com/openais-chatgpt-update-adjustable-warmth-enthusiasm-and-emojis/)
2. **Multimodal model directly processes audio.** Not STT → text-LLM → TTS. The model ingests audio directly, which is what lets it detect and respond to prosody in real time. Reduces interruptions (per March 2025 voice mode update), which is exactly what our barge-in system (`project_predictive_barge_in_v1.md`) is chasing. [How To Use ChatGPT's Advanced Voice Mode](https://learnprompting.org/blog/how-to-use-openai-chatgpt-advanced-voice-mode) + [ChatGPT Voice Mode Review](https://qcall.ai/chatgpt-voice-mode-review)
- Applicability to Dodami: the "parent-facing personality slider" as a product lever — Will could let parents choose: "reserved / balanced / playful" — is concrete and maps onto our existing 4 elements.

### Korean-context note (comparables we checked)
- Kakao AI Tutor / 밀리의서재 / 뤼튼 — explicitly searched. Search results did not surface concrete kid-product mechanics we could cite; these are mostly text-based chatbots for older users or adult language-learning apps. No direct voice-first-for-Korean-kids competitor found in current search. [8 Korean AI Chatbots](https://www.fluentu.com/blog/korean/korean-chat-bot/) + [Sejong Institute AI teacher](https://play.google.com/store/apps/details?id=com.kingsejong.ai&hl=en_US)
- KAIST research-prototype tutor (RAG-grounded, course-content-anchored) — shows the direction academic Korean products are moving: ground every answer in actual curriculum content. [Korea Herald on KAIST tutor](https://www.koreaherald.com/article/10505878)
- No direct competitor appeared to combine: voice-first + Korean kids + persistent character. This is consistent with our `project_fundraising_strategy` positioning ("voice-first AI tutor for Korean kids" = whitespace).

### Cross-product pattern summary
Five mechanics that show up across multiple products and that Dodami doesn't currently ship:
- **Opening callback to prior arcs**, not a menu. (Pi, Moxie, Character.AI, Khanmigo.)
- **Ongoing narrative/mission arc**, not stateless sessions. (Moxie, Duolingo.)
- **Stable, legible character personality**, not generic-with-4-flavors. (Duolingo characters, Khanmigo persona, Character.AI, Pi.)
- **Prosody carries mood**, not just content. (Pi, ChatGPT, Moxie.)
- **First 3-5 turns are exploratory / character-establishment**, not transactional menu-offer-accept cycles. (Pi, Moxie, Duolingo Roleplay.)

Two mechanics that DON'T broadly apply because of our scale/age constraints:
- **Voice cloning from 10-15s user clip** (Character.AI): blocked by Korean-child-voice quality per `project_synthetic_child_voice.md`.
- **Long-term memory across months** (Pi): we have the infrastructure but 가족 privacy posture + pilot scale makes it less urgent than the closer-in mechanics above.

---

## Scope limits of this research

- 12 flat moments cited; larger sample would refine. The rubric audit scored 10 turns from 1 session; the strategy doc's ship-criterion is 10 sessions.
- Code audit covers the persona/policy/turn path. Not reviewed: STT quality, TTS quality (both known to be flat per memory), dashboard/parent surface.
- Competitive teardown relies on public reviews + product pages; no hands-on testing of competitors. URLs cited for each claim.
- Audio evidence from 이현 session on Mac (`~/Downloads/이현_turn3.wav` etc.) not listened to for this audit.
- Element-personality "0/10 in rubric" claim is from the 10-turn slice; no diff-test of the 4 cards on identical prompts was run (flagged as recommendation #1 in scorecard).

Sources (every claim above cited inline):
- [Pi AI Review 2026](https://techvernia.com/pages/reviews/chatbots/pi-ai.html)
- [Pi by Inflection AI Review](https://toolstack.io/tools/pi-by-inflection-ai)
- [Meet Pi: Transforming AI Chatbot Experience](https://apix-drive.com/en/blog/reviews/pi-by-inflection-personal-ai)
- [Pi AI Guide 2026](https://aitoolsdevpro.com/ai-tools/pi-guide/)
- [Introducing Duolingo Max](https://blog.duolingo.com/duolingo-max/)
- [What is Duolingo Max?](https://www.mlopsaudits.com/blog/what-is-duolingo-max-the-gpt-4-powered-language-learning-tool-explained)
- [How Zari Lin Lucy Bea and Lily came to life](https://blog.duolingo.com/duolingo-female-character-origin-stories/)
- [Lily Duolingo Character Guide](https://pushtolearn.com/post/lily-duolingo)
- [Moxie review - Reviewed.com](https://www.reviewed.com/accessibility/content/moxie-robot-review-kids-social-companion)
- [Moxie AI Companion](https://moxierobot.com/products/ai-robot)
- [Dezeen Moxie coverage](https://www.dezeen.com/2020/09/09/moxie-teaching-robot-children-embodied/)
- [IEEE Spectrum Moxie](https://spectrum.ieee.org/moxie-a-social-robot-for-childhood-development)
- [Moxie axios coverage](https://www.axios.com/2024/05/31/moxie-robot-kids-companion-genai)
- [Meet Khanmigo](https://www.khanmigo.ai/)
- [KidsAI Tools Khanmigo review](https://www.kidsaitools.com/en/articles/review-khan-academy-khanmigo)
- [Khan Academy blog: New Essay Feedback Tool](https://blog.khanacademy.org/new-essay-feedback-tool/)
- [Khanmigo Writing Coach](https://www.khanmigo.ai/writingcoach)
- [Korea Herald on KAIST tutor](https://www.koreaherald.com/article/10505878)
- [Character.AI memory blog](https://blog.character.ai/helping-characters-remember-what-matters-most/)
- [What Powers Character AI Chat](https://playbattlesquare.com/tech/what-powers-character-ai-chat-memory-nlp-and-personality-models/)
- [Character AI on emergentmind](https://www.emergentmind.com/topics/character-ai-c-ai)
- [8 Korean AI Chatbots](https://www.fluentu.com/blog/korean/korean-chat-bot/)
- [Sejong Institute AI teacher](https://play.google.com/store/apps/details?id=com.kingsejong.ai&hl=en_US)
