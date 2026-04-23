# Stream D — Multi-Turn Architecture (PARKED STUB)

**Status:** PARKED pending Stream C ship.
**Why parked:** Want Stream C's prompt-side multi-turn readiness (delimiter emission, `<plan>/<say>` contract) to inform D's system requirements rather than design D blind.
**Related spec:** [Stream C design](./2026-04-23-dodami-magic-design-C.md)

## What D would build

A system that delivers **multiple response beats with paced timing**, mimicking how people don't say everything in one go.

Example flow:
```
Kid: "도담아~ 나 심심해!"
Dodami beat 1 (immediate): "안녕 연우야!"
  [TTS plays, ~1.5s]
  [pause beat ~300ms]
Dodami beat 2: "심심해? 그럼 우리 같이 놀자!"
  [TTS plays, ~2s]
  [pause beat ~500ms]
Dodami beat 3: "뭐할까? 하고 싶은거 있어?"
  [TTS plays, ~2s]
  [mic reopens for kid input]
```

Versus today's single-blob:
```
Dodami: "안녕 연우야! 심심해? 그럼 우리 같이 놀자! 뭐할까? 하고 싶은거 있어?"
  [TTS plays, ~5s as one continuous stream]
  [mic reopens]
```

Multi-turn delivers:
- Natural conversational rhythm
- Kid can interrupt mid-beat if they want ("오 나 알아!")
- Dodami can react to very-short kid reactions between beats ("어" "응" "아")
- Closer to how a real person would speak

## Rough architectural shape (unverified)

- **Emission:** LLM outputs `beat1|||beat2|||beat3` in single response (Stream C already designs this)
- **Parsing:** Response handler splits on `|||`, queues beats for sequential delivery
- **Pacing logic:**
  - Beat N-1 finishes playing → start TTS synthesis for beat N
  - Insert inter-beat pause based on content (short for "안녕!", longer for complex handoff)
  - Open mic AFTER last beat, not after beat 1
- **Mid-turn interrupt handling:**
  - Kid speaks during beat 2 → detect barge-in → stop beat 2 TTS mid-stream → cancel beat 3 → accept kid input as new turn
  - What about kid's tiny reactions between beats ("응", "오")? Are those turns or acknowledgments? Probably acknowledgments — don't terminate Dodami's turn
- **Error recovery:**
  - TTS fails mid-beat-2 — fall back to concatenating remaining beats as one
  - Kid goes silent during pause — timeout and continue, or wait?
  - Anthropic LLM outputs malformed delimiters — fall back to single-beat flattening

## Known unknowns

- **Exact pacing algorithm.** How long between beats? Content-dependent? Fixed?
- **Barge-in mid-beat-2 semantics.** Is beat 1 part of conversation history? If kid interrupts beat 2, is beat 3's content discarded entirely or stored as "what Dodami was going to say"?
- **Backpressure.** If Haiku is slow and we've started playing beat 1, can beats 2-3 still arrive in time? Need streaming? Or enforce full-response-first?
- **Conversation history recording.** Do we store beats as N separate turns or one turn with internal structure?
- **Safety pipeline interaction.** Does safety check beat-by-beat or the whole response? Safety currently checks whole response — multi-beat would need beat-wise check or batch-check-then-release-sequentially.
- **Cost model.** Per-turn cost unchanged (one LLM call). But TTS is per-beat — possibly 2-3x TTS calls per turn. Coordination with Supertone cloud rate limits.

## Dependencies

- Stream C ships delimiter-emitting prompt contract ✓ (designed in C)
- `ws_handler.py` refactor to support sequential beat delivery (major surgery)
- TTS backend parallelism or sequential invocation pattern
- Safety pipeline decision: per-beat vs whole-response
- Barge-in / mic-gate logic already exists (PR #46 mic-gate hard mute during TTS, PR #48 retire predictive barge-in, PR #47 retire echo-correlation) — these are the components that multi-turn builds on top of

## When to unblock D

- Stream C Wave 1-2 ship AND are observed in pilot for 1-2 weeks
- Parent + kid reactions confirm the C baseline IS better (so we know multi-turn is additive, not compensating for broken baseline)
- Will decides multi-turn is the next investment

Estimated effort: 1-2 weeks of system work + 1 week of tuning. Runs AFTER Stream C validates.

## Risk if we never ship D

Stream C's design is multi-turn-ready but flattens at runtime. Without D, Dodami still produces the same single-blob output as today (but with better content, voice, memory). The EXTRA magic from proper pacing is left on the table.

Parents who've used Pi or Duolingo Max will notice the difference. For the pilot audience (first-time kids + their parents), C alone is likely a significant step up — D is polish.

## If unblocking happens

Convert this stub to a full design spec via brainstorming flow (explore → questions → approaches → design). Don't implement from this stub — it's notes, not a design.
