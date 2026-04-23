# Dodami Magic — Project Charter

**Status:** IN PROGRESS (Stream C brainstorm live; A + B research agents dispatched in parallel).
**Author:** Session Yellow, kicked off 2026-04-22, resumed 2026-04-23.
**North Star** (from Will, 2026-04-22): *"I want people who first use Dodami to be just amazed, adults and kids alike. I want them to really feel like Dodami is smart and it's genuinely fun to talk to. And Dodami should be able to say more than one turn — mimicking how people don't say everything in one go."*

## What "magic" means (grounding examples Will gave)

**Example 1 — conversational competence.** Kid is bored, asks for help filling time. Dodami reads the energy, offers appropriate-shaped suggestions (pairs, menus, or self-commit — whatever fits), pivots on rejection, commits enthusiastically once decided, confirms readiness, then delivers QUALITY content (a real riddle, not a generic one).

**Example 2 — audience-aware teaching.** Kid asks a deep question ("how does a car go?"). Dodami explains at the kid's level — not an engineer's. If the kid doesn't get it, Dodami re-explains DIFFERENTLY (new analogy, new angle), not the same words louder. Patience. Scaffolded teaching.

## The unifying principle (Will's correction to early framing)

**Dodami is smart because it's PRESENT.** It's paying attention to the kid's energy, understanding, and mood, and adjusting in real time. This is different from "Dodami has a great persona." Persona is the surface; presence is the engine.

**Design must encode PRINCIPLES, not RULES.** Examples like "offers pairs of options" are illustrations of "read the room and match the situation" — not a rule about offering exactly 2 things. High-variance expression, principle-level consistency. The trap (AI-specific): LLMs crystallize examples into rules. Counter: few-shot examples must deliberately show RANGE across similar situations.

**Hard rules are rare.** Pivot-gracefully-on-rejection, honor-kid's-choice, safety rails — these are ~95-99% rules with explicit exceptions. Shape-level choices (how many options, response length, opening phrase, etc.) are tendencies that vary with context.

## Streams (decomposition + dependency graph)

| Stream | Scope | Status | Depends on | Deliverable |
|---|---|---|---|---|
| **A — Diagnose & observe** | Audit real pilot sessions + competitive teardown (Pi, Duolingo Max, Moxie, Khan Kimi, 카카오) + code audit of where personality flattens today | IN PROGRESS (parallel research agent dispatched) | — | `docs/superpowers/research/stream-A-diagnose.md` |
| **B — Research prompt SOTA** | Anthropic/OpenAI/Karpathy/arxiv on prompt engineering, dialogue systems, children's conversational AI, Korean conversational style, multi-turn dialogue architectures | IN PROGRESS (parallel research agent dispatched) | — | `docs/superpowers/research/stream-B-prompt-sota.md` |
| **C — Magic-delivery design** | Concrete mechanisms that deliver "amaze": prompt-layer architecture, response-shape variance, callback memory, meta-moments, audience-aware explanation, re-explain-differently protocol, content quality bar | IN BRAINSTORM (live with Will) | A + B | `docs/superpowers/specs/2026-04-22-dodami-magic-design-C.md` |
| **D — Multi-turn architecture** | System surgery: LLM emits delimited beats; ws_handler paces with TTS sequencing; mid-turn interrupt handling; error recovery | PARKED (stub) | C (to know requirements) | `docs/superpowers/specs/2026-04-22-multi-turn-architecture-deferred.md` |
| **E — Evaluation framework** | Upgrade `/improve-demo` judges to include "magic" axes: surprise, warmth, callback-continuity, presence, personality-consistency. Kid panel vs judge panel | NOT STARTED | C + D | TBD |
| **F — Implementation** | Wave plans that `/codex implement` (now plugin-powered) can execute. Deploy + canary monitor via `/improve-demo` iteration loop | NOT STARTED | C + D + E | TBD |

**Parallelism strategy:** A + B run concurrent (pure research). C is interactive brainstorm, absorbing A+B findings when they land. D can start in parallel to C later. E depends on C+D outputs. F is execution.

## Dodami context snapshot (current state, for streams to ground in)

- Pilot is live on 5090 (per `project_dodami_deployment.md`). Cookie auth, fail-closed safety, 5-bucket STT. LLM/TTS cloud migration in progress.
- Prompts v6 shipped (per `project_prompt_v3_results.md`): per-turn dynamic injection — anti-repetition + curiosity ask-back. 100% pass on Gemma 4 31B eval. That was a SAFETY + spec-compliance eval, not a MAGIC eval. Baseline is "doesn't break" not "is amazing."
- 4 deployed characters: 도담이, 불꽃이, 해나리, 바라미 (per `project_4element_characters.md`).
- Content rework plan locked 2026-04-19 (per `project_content_design_rework.md`): persona depth + TELL-mode + callback memory over 2-3 weeks. This Stream C subsumes and extends that plan.
- `/improve-demo` skill exists: 7 judges in 2 groups, 5 safety layers, target 9.5/10. Currently at 8.03 (7-judge recalibrated). Judges are safety/accuracy-weighted, not magic-weighted.
- Recent 3-mode dispatch bugs (riddle, greeting safety FPs, chanhyuk profile leak) suggest the current state-machine layer has gaps in graceful-fallback behavior — relevant to Stream A's audit.

## Key decisions already made (Stream C-bound, called out so they don't drift)

1. **Multi-turn-ready design default.** Even if runtime emits single-turn today, Stream C's prompt system uses a delimiter (e.g. `|||`) for response beats. Runtime flattens until D ships. Future-compatible at ~zero cost.
2. **Principles > rules in prompt expression.** Few-shot examples will show range, not converge on one shape.
3. **Hard rules tagged explicitly.** Safety + honor-rejection + kid-choice-respect get "always" framing; everything else gets "tendency" framing.
4. **Composable prompt layers.** System / persona / session-memory / per-turn-injection / safety — clear contracts between each. Don't monolith.
5. **Stream D parked, not abandoned.** C's output includes multi-turn assumptions; D's stub captures what we'd need to learn before unblocking D.

## Open questions tracked here (C will resolve most)

- How do we represent "audience level" in the prompt? Age-band? Explicit age? Inferred from prior turns? A mix?
- What's the callback-memory unit — stored verbatim, summarized, or extracted-facts?
- How aggressive should the "re-explain differently" protocol be? Auto-detect "모르겠어" / "뭐라고?" + retry? Or always include an alternate explanation in the first response?
- How do we balance "variable shape" with "persistent personality"? Persona consistent across all shapes, but shapes themselves vary?
- Meta-moments (Dodami catching itself, self-referencing) — universal or rare?

## Non-goals (what this project is NOT)

- Not a UX overhaul. `demo-live.html` styling and the visual frontend are out of scope.
- Not a safety-rails rewrite. The existing Tier-1/Tier-2/crisis pipeline stays; we design C to flow through it cleanly.
- Not a model migration. Stays on Haiku primary + Solar fallback per `project_llm_migration_decisions.md`.
- Not a STT/TTS change. Stays on Whisper v4 local + Supertone Sona 2 Flash.

## Changelog

- **2026-04-22 (Yellow, initial):** Charter created. Streams decomposed. A + B research agents dispatched. Stream C brainstorm initiated live with Will.
- **2026-04-23 (Yellow, resumed after failed autonomous attempt):** Previous autonomous "go full auto" instruction wasn't executed (Claude Code is turn-based; no CronCreate/ScheduleWakeup was set up). Restarted interactively.
