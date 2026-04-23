# Stream B — Prompt Engineering State of the Art

Research compile for Dodami Magic (2026-04-22). Goal: find techniques to
make Dodami's Haiku-driven responses feel more magical — present, audience-aware,
varied, playful, callback-memory-capable, multi-beat-paced, and Korean-kid-native.

Each section:
- 2–3 concrete techniques / patterns / findings from 2025-2026 state of the art.
- A "→ Dodami:" note on how we steal it for our current Haiku + persona prompt +
  per-turn dynamic injection stack.
- Primary-source URLs.

Bias of this compile: *concrete and implementable*, not survey-ish. Where a
technique is well-known generic advice (e.g. "use clear instructions"), we skip
it. Where a technique is counter-intuitive or under-adopted, we spend more words.

---

## 1. Anthropic's prompting guides — what's new since 2024, applied to Dodami

### 1.1 XML tag structure is first-class, not optional

Claude is trained on XML-tagged data and "has been fine-tuned to respect
arbitrary hierarchical XML tags" — which is why tag-structured prompts
beat natural-language-paragraph prompts by a non-trivial margin. Anthropic's
own docs now explicitly recommend combining XML tagging with multishot
(`<examples>`) and thinking (`<thinking>`/`<answer>`) for "super-structured,
high-performance prompts."

The non-obvious part: *tag names should be semantic to the task domain*. Not
just `<instructions>` and `<response>`, but `<kid_profile>`, `<callback_memory>`,
`<recent_turns>`, `<forbidden_moves>`, `<response_shape>`. Semantic tags let
later Claude calls (e.g. a judge pass, a repair pass, a content planner)
reference exactly one section without accidental over-quoting.

→ Dodami: restructure the Haiku system prompt into ~8 named sections:
`<persona>`, `<audience>` (kid_id, age, grade, CEFR-like Korean level),
`<callback_memory>` (last 3 callback-worthy moments from prior sessions),
`<recent_turns>` (last N turns this session), `<mode>` (voice vs typed),
`<response_shape>` (≤3 sentences, ≤35 syllables, 반말), `<forbidden_moves>`
(no spoiling answers, no over-correcting pronunciation), `<examples>`
(3–5 hand-written magic exchanges).

Source: [Use XML tags to structure your prompts — Claude API Docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags)

### 1.2 Role/persona in the system prompt, style in few-shot examples

Anthropic's guidance splits persona into two prompt locations: the *role*
lives in the system prompt (`"You are Dodami, a 4-element Korean AI tutor
friend..."`), but *tone/voice/register* is more reliably controlled by 3–5
few-shot examples than by descriptive adjectives in the system prompt.
Their own "parent-bot" example: describing "warm, kid-friendly tone"
produced formal robotic answers; showing 3 example exchanges with the
desired voice produced the right register immediately.

Anthropic also publishes a specific "keep Claude in character" page that
recommends (a) example scenarios covering 3–5 hard edge cases (user tries
to break persona, user asks meta-questions about "are you AI", etc.),
(b) prefill the assistant turn with the persona's voice anchor (e.g.
`assistant: "도담이가 여기 있어~ "`).

→ Dodami: Will's persona doc is long. Slim the descriptive prose, add 5
Korean-native example exchanges covering (i) kid gets math wrong, (ii)
kid is distracted/tangential, (iii) kid asks "is Dodami a robot",
(iv) kid uses a too-advanced word Dodami shouldn't spoil, (v) kid is
emotionally flat/upset. Prefill every assistant turn with the character
greeting hook per-persona (도담이/불꽃이/해나리/바라미 each get their own
voice-anchor phrase).

Sources:
- [Giving Claude a role with a system prompt](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts)
- [Keep Claude in character with role prompting and prefilling](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/keep-claude-in-character)
- [Using Examples (Few-Shot Prompting) — AWS prompt-engineering-with-anthropic-claude-v-3](https://github.com/aws-samples/prompt-engineering-with-anthropic-claude-v-3/blob/main/07_Using_Examples_Few-Shot_Prompting.ipynb)

### 1.3 Prompt caching is the unlock for "heavy persona, cheap per-turn"

The constraint Dodami has been fighting: a long persona + callback-memory
system prompt makes every turn expensive. Anthropic's prompt caching
changes the economics — cached prefixes cost ~10% of non-cached tokens and
deliver up to 85% lower latency (their published book-chat example went
from 11.5s → 2.4s). With `cache_control: {type: "ephemeral", ttl: "1h"}`
plus the new extended-cache TTL option, a single-child session keeps the
persona hot for the whole session.

Practical cache layout for voice-first kid chat:
1. Persona block (never changes per session) — cached.
2. Kid profile + callback memory (changes per session, not per turn) — cached.
3. Recent turns (changes per turn) — not cached.
4. Current user turn — not cached.

Place cache breakpoints at layer 2→3 boundary. This means a 2000-token
persona prompt costs full price once per session and ~200 cached tokens
per turn afterward.

→ Dodami: currently (per project_cloud_migration_plan.md) we already chose
Haiku for concurrency, but per-turn dynamic injection isn't cache-aware.
Split the dynamic injection into "stable-this-session" and "fresh-this-turn"
blocks, put the `cache_control` breakpoint between them, and we get Pi-like
persona depth at Haiku cost.

Sources:
- [Prompt caching — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Prompt caching with Claude — Anthropic News](https://www.anthropic.com/news/prompt-caching)

### 1.4 Claude 4.x is more *literal* than 3.x — scope drift got harder, but implication-following got weaker

A behavior change from the 4.x release that matters for Dodami: Claude 4.x
"takes you literally and does exactly what you ask for, nothing more."
Earlier Claude versions would infer what you probably wanted and over-deliver
(adding explanations, caveats, preamble). Haiku 4.5 inherits this literalness.

Implication: per-turn dynamic instructions like "be curious" or "sound warm"
produce weaker behavior change than they used to. You now have to *show*
(example) rather than *tell* (adjective). Similarly, negative instructions
("don't spoil the answer") now actually *stick* better than before — they
used to be a known Claude-3 failure mode.

→ Dodami: audit the per-turn dynamic injection for adjective-soup
instructions ("warm, curious, playful, patient"). Replace each with
either (a) a positive example of the behavior from a real prior
successful session, or (b) a negative rule with a concrete forbidden
phrase ("never say '정답은...' — say '같이 풀어볼까?' instead").

Source: [Prompting best practices — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)

### 1.5 Extended thinking vs. the "think" tool — for Dodami probably neither, but the pattern transfers

Anthropic now offers three reasoning-surface options: extended thinking
(pre-response reasoning block), the `think` tool (mid-response reflection
call), and adaptive thinking (model decides per-request). Current
Anthropic guidance: extended thinking supersedes the think tool for
most cases; adaptive thinking is recommended on Opus 4.7/4.6 and
Sonnet 4.6.

Haiku 4.5 doesn't have extended thinking. But the *pattern* — forcing a
structured planning step before the response — is the right shape for
multi-beat Dodami answers. We can simulate it with explicit
"response-plan-then-response" instructions: ask Haiku to emit
`<plan>` (what beats to hit, in order) then `<say>` (the Korean reply),
parse client-side, drop the `<plan>` before TTS.

Anthropic's own tip: "Use `<thinking>` tags inside your few-shot examples
to show Claude the reasoning pattern. It will generalize that style to
its own extended thinking blocks." For Haiku without native thinking,
this manifests as: put `<plan>`-then-`<say>` few-shot examples in the
system prompt, and Haiku will reliably imitate the structure.

→ Dodami: for multi-turn delivery (the "magic" gap), add a
`<response_plan>` hidden block to every turn. Three required beats:
(1) acknowledge what the kid said (callback), (2) offer content
(the actual tutor move), (3) hand the ball back (question or prompt).
Parse client-side, only TTS the user-facing text.

Sources:
- [Building with extended thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [The "think" tool: Enabling Claude to stop and think — Anthropic Engineering](https://www.anthropic.com/engineering/claude-think-tool)
- [Adaptive thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)

### 1.6 Claude-specific tip: negative examples + "reasoning before answer" in few-shot

A subtle, less-documented Anthropic pattern: Claude outperforms when few-shot
examples contain *both* a wrong response and a right one, side-by-side, with
a one-line rationale between them. This is different from vanilla few-shot
(which just shows good examples). Format:

```xml
<example>
<user>도담이 나 수학 못해.</user>
<bad_response>괜찮아요! 수학은 누구나 어려워해요. 연습하면 잘할 수 있어요!</bad_response>
<why_bad>Teachery adult register, empty reassurance, no callback, no invitation to play.</why_bad>
<good_response>음~ 아까 곱셈 세 개 맞췄잖아! 난 너 못한다고 생각 안 해. 우리 쉬운 거부터 다시 해볼래?</good_response>
</example>
```

Claude picks up "what the difference is" more reliably than "what the right
answer is" in isolation.

→ Dodami: curate 5–7 such side-by-sides from real pilot logs
(project_taeun_canonical_session.md is a goldmine — 태은 is our first
adversarial-data session, use those turns). Put them in the system prompt
under `<examples>`.

Source: [Prompt engineering overview — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)

---

## 2. OpenAI's GPT-5 / GPT-5.4 prompting guide — transferable patterns

The Codex plugin's local `gpt-5-4-prompting` skill already encodes most of
OpenAI's meta-patterns as reusable XML blocks. That file is at
`/Users/will/.claude/plugins/cache/openai-codex/codex/1.0.4/skills/gpt-5-4-prompting/references/prompt-blocks.md`.
Below are the patterns that transfer to a conversational child-facing
agent (not a coding agent), with Dodami-specific mapping.

### 2.1 Block-structured prompts with named contracts

OpenAI's explicit recommendation: "Prompt [GPT-5] like an operator, not a
collaborator. Keep prompts compact and block-structured with XML tags.
State the task, the output contract, the follow-through defaults, and the
small set of extra constraints that matter."

The skill's standard blocks that apply to Dodami:
- `<task>`: the concrete job. For Dodami: "Respond as [persona] to this kid's
  turn, in Korean 반말, staying inside the shape rules."
- `<structured_output_contract>` / `<compact_output_contract>`: the exact
  output shape. For Dodami: "Return one `<plan>` XML block then one `<say>`
  block. `<say>` is Korean, ≤3 sentences, ≤35 syllables total, 반말."
- `<default_follow_through_policy>`: what to do when the kid's intent is
  unclear. For Dodami: "If the kid's utterance is ambiguous or a single
  word, continue the current activity thread rather than asking a
  clarifying question — unless safety-relevant."
- `<grounding_rules>`: never invent facts about the kid. For Dodami:
  "Never reference a callback memory that isn't in `<callback_memory>`."

→ Dodami: adopt the block vocabulary verbatim for the system prompt —
they already have wide LLM training-data exposure because Anthropic and
OpenAI both documented them publicly.

Sources:
- [GPT-5.4 Prompt guidance — OpenAI API](https://developers.openai.com/api/docs/guides/prompt-guidance)
- [GPT-5 prompting guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide)
- [GPT-5.2 Prompting Guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5-2_prompting_guide)

### 2.2 Instruction-hierarchy collapse — merge contradictions into a single ranked list

The GPT-5 series guide has a specific counter-pattern: when you have rules
from different sources (persona prompt + per-turn injection + tool contract
+ safety layer), *don't just concatenate them*. Instead, merge them into
one explicitly-ranked list with precedence. Contradictory rules degrade
performance more than clear-hierarchy rules; GPT-5.2 in particular follows
a stated hierarchy well when it's present.

Example hierarchy for Dodami:
```xml
<rule_hierarchy>
1. Safety (blocked topics, 병변·학대·자해·성) — never override.
2. Persona (반말 register, ≤3 sentences, ≤35 syllables, character voice).
3. Pedagogy (don't spoil answers, ZPD: one step above current level).
4. Activity thread (stay in current mode unless kid asks to switch).
5. Style (callback memory, curiosity, warmth).
When in conflict, higher-numbered yields to lower.
</rule_hierarchy>
```

→ Dodami: audit current per-turn injection for rule conflicts.
project_chanhyuk_greeting_safety_fp.md is literally an example of
rule-conflict damage (profile prompt produces "컨설팅펌", Tier-2 safety
blocks). A hierarchy declaration in the prompt lets the model self-resolve
instead of having us patch it downstream.

Sources:
- [GPT-5.2 Prompting Guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5-2_prompting_guide)
- [GPT-5.1 Prompting Guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5-1_prompting_guide)

### 2.3 Reasoning-effort knob (GPT-5: `reasoning_effort`, Claude: can't tune directly, but we can fake it)

GPT-5.2 exposes `reasoning_effort` as `none | minimal | low | medium | high | xhigh`.
The guide's recommendation: "iterate by either bumping reasoning_effort one
notch or making incremental prompt tweaks, then re-measure." The key insight
is that *different turns need different effort*. A "yes/no" acknowledgment
turn needs `minimal`; a "help me understand why 7×8=56" turn needs `medium`.

Haiku doesn't expose this knob. But the pattern transfers via prompt
routing: we can classify the incoming user turn (cheap local call or rule-based)
and pick a *different system prompt* per turn-type. A "small talk" prompt is
~300 tokens; a "tutoring step" prompt is ~2000 tokens with callback memory
and examples. Same model, different budget.

→ Dodami: add a lightweight turn-type classifier (regex + heuristics, no
LLM needed for the common cases) that picks which variant of the Haiku
prompt to send. Three variants at minimum: `SMALL_TALK`, `TUTOR_STEP`,
`SAFETY_SENSITIVE`. Saves cost *and* improves output — narrow prompts
produce crisper responses.

Source: [GPT-5.2 Prompting Guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5-2_prompting_guide)

### 2.4 Completeness contract vs. conciseness contract — pick one explicitly

The Codex skill's `completeness_contract` block and its `compact_output_contract`
block are mutually exclusive, and OpenAI explicitly recommends choosing.
Don't send both. For a voice-first kid agent, Dodami wants `compact`
almost always — long answers kill voice-interaction feel. But there's a
specific class of turns where `completeness` matters: activity hand-offs
(start of a new mini-game, end-of-session wrap-up, safety-sensitive
redirect). These need 3 beats reliably, not just 1.

→ Dodami: Along with the turn-type classifier (2.3), attach the
appropriate contract block per turn-type. Small talk → compact.
Activity hand-off → completeness (3-beat required).

Source: [prompt-blocks.md — gpt-5-4-prompting skill](file:///Users/will/.claude/plugins/cache/openai-codex/codex/1.0.4/skills/gpt-5-4-prompting/references/prompt-blocks.md)

### 2.5 Anti-pattern: "think harder and be very smart"

Call out from the Codex anti-patterns file: asking the model to "think harder"
or "be very smart" does *nothing*. Better contracts beat bigger adjectives.
This is OpenAI's public stance but it applies equally to Haiku — we have
seen this ourselves (feedback_dont_overjustify.md is the human analog).

→ Dodami: grep the current persona prompt for words like "creative",
"thoughtful", "brilliant", "magical", "warm", "curious" used as bare
adjectives. Each one should be either (a) replaced with a `<verification_loop>`
contract block, or (b) deleted and replaced with a few-shot example of the
desired behavior.

Source: [codex-prompt-antipatterns.md — gpt-5-4-prompting skill](file:///Users/will/.claude/plugins/cache/openai-codex/codex/1.0.4/skills/gpt-5-4-prompting/references/codex-prompt-antipatterns.md)

---

## 3. Recent research on dialogue systems / conversational AI (2025-2026)

### 3.1 Persona drift is measurable — reduce it with Q&A consistency checks

The NeurIPS 2025 paper "Consistently Simulating Human Personas with Multi-Turn
Reinforcement Learning" defines three measurable persona-drift metrics:
- **Prompt-to-line consistency**: does this turn match the character sheet?
- **Line-to-line consistency**: does this turn match earlier turns in the
  same session?
- **Q&A consistency**: if we query the character about itself, do the
  answers agree with the character sheet and prior turns?

They fine-tuned with these as reward signals and reduced persona inconsistency
by ≥55% on three roles (patient, student, chat partner). For Dodami, the
non-RL takeaway: *use these as eval metrics*, not training. Run them
periodically on the last 20 turns of a session to detect drift, and if
detected, inject a persona-refresh note into the next system prompt.

→ Dodami: instrument the pilot logs with a Q&A-consistency eval.
Probe questions: "도담이 몇 살이야?", "불꽃이는 어떤 색깔 좋아해?",
"해나리는 뭘 제일 잘해?". These should always produce the same answer
from the same persona. When they don't, we have measurable persona drift
to triage. Cheap to run (one Haiku call per probe).

Sources:
- [Consistently Simulating Human Personas with Multi-Turn Reinforcement Learning — arxiv 2511.00222](https://arxiv.org/abs/2511.00222)
- [A Persona-Aware LLM-Enhanced Framework for Multi-turn — ACL 2025 findings](https://aclanthology.org/2025.findings-acl.5.pdf)

### 3.2 Emotion-reward fine-tuning for character-coherent role-play

The paper "Enhancing Character-Coherent Role-Playing Dialogue with a
Verifiable Emotion Reward" introduces the Verifiable Emotion Reward (VER)
objective and a 230K-dialogue dataset (CHARCO) with persona and emotion
labels. The non-FT takeaway: *emotion labels as control signals beat
personality adjectives*. Instead of "warm, patient, curious" in the
persona, define an emotion state machine per persona and ship the
current state with each turn:

```xml
<persona_emotion_state>
current: gentle_encouragement
just_before: neutral_curious
never_in_this_mode: strict_correction, disappointed
</persona_emotion_state>
```

This gives the model a concrete control surface the dynamic injection
can steer turn-by-turn.

→ Dodami: each of the 4 personas (도담이/불꽃이/해나리/바라미) gets an emotion
lexicon — 5-8 named states with example utterances for each. Dynamic
injection picks the current state based on the last-turn classification
(kid-frustrated → gentle_encouragement; kid-excited → playful_matching;
kid-off-task → curious_redirect). Emotion state becomes a first-class
prompt field.

Source: [Enhancing Character-Coherent Role-Playing Dialogue with a Verifiable Emotion Reward — MDPI Information 16/9/738](https://www.mdpi.com/2078-2489/16/9/738)

### 3.3 Relation-graph prompting for multi-turn instruction following

GraphIF (arXiv 2511.10051, Jan 2026) proposes modeling a multi-turn dialogue
as a directed relation graph: each turn is a node; edges are
relation-types (clarification-of, follow-up-to, contradicts, etc.). A
"graph prompt" then summarizes the graph into the system prompt before
each new generation. Training-free, plug-and-play; they report significant
gains on multi-turn instruction-following benchmarks.

For Dodami, the lightweight version: maintain a short running list of
*dialogue acts* ("kid asked question", "Dodami explained", "kid showed
understanding", "kid got distracted", "Dodami redirected") and inject as
`<recent_acts>` into the prompt. The model then reasons about the *shape*
of the conversation, not just the last utterance.

→ Dodami: add a per-turn dialogue-act classifier (5-class max: ASK,
ANSWER, REPAIR, REDIRECT, BOND). Keep the last 6 acts in the prompt.
When 4+ are the same act, inject a "change pace" nudge. This directly
addresses the "feels flat" gap — flatness often manifests as repeated
same-act turns.

Source: [GraphIF: Enhancing Multi-Turn Instruction Following for Large Language Models with Relation Graph Prompt — arxiv 2511.10051](https://arxiv.org/html/2511.10051v2)

### 3.4 FlowKV — isolated KV cache management for multi-turn coherence

FlowKV (arXiv 2505.15347) attacks a specific degradation: as multi-turn
context grows, standard KV cache compression loses the earlier turns'
emotional and persona signals because compression prioritizes recent
high-entropy tokens. Their fix isolates KV cache regions by source
(system prompt / character / recent turns) and applies different
compression budgets to each. The practical takeaway for us — even
without touching inference — is that *where you put persona tokens
matters*. Persona and callback memory should go in a cache region
that never gets truncated, and "recent turns" should be the pressure
valve.

→ Dodami: when we're close to context budget, prune from the middle
("recent turns" 3-10 back), not from the beginning (persona) or end
(last turn). This is inversion of the default "oldest turns drop first"
policy and matches what FlowKV found empirically.

Source: [FlowKV: Enhancing Multi-Turn Conversational Coherence in LLMs via Isolated Key-Value Cache Management — arxiv 2505.15347](https://arxiv.org/html/2505.15347v1)

### 3.5 Theory of mind is weak but probe-able — use it to detect "did they understand?"

The 2025 landscape: LLMs pass first-order false-belief tests at near-human
levels (Nature Human Behaviour 2024, PNAS 2024) but fail at higher-order
social cognition and mental-state tracking in long conversations
(RecToM benchmark, Nov 2025). ToMMY (Theory of Mind: Making explanations
Yours, 2024-2025) is a chain-of-prompts design that asks the model to
infer user background and expertise *before* generating content — and
shows this improves personalization.

Concrete pattern: add a pre-generation "user state estimate" block:

```xml
<user_state_estimate>
comprehension: partial  — kid repeated the question back, hasn't answered it.
affect: low  — short clipped utterances, 2 out of last 3 turns.
engagement: at_risk  — next turn needs re-engagement, not more content.
</user_state_estimate>
```

This is Haiku-cheap (tiny block) and changes the model's generation
policy materially — it stops piling content on a disengaged kid.

→ Dodami: this is a layer we already have partial machinery for (the
dialogue-act classifier from 3.3). Extend it to also emit a 3-dim
user-state estimate. Feed it into the system prompt. The *shape* of
each turn then adapts to the estimate ("partial comprehension" → next
turn re-explains with simpler analogy, not a new concept).

Sources:
- [RecToM: A Benchmark for Evaluating Machine Theory of Mind in LLM-based Conversational Recommender Systems — arxiv 2511.22275](https://arxiv.org/abs/2511.22275)
- [Infusing Theory of Mind into Socially Intelligent LLM Agents — arxiv 2509.22887](https://arxiv.org/html/2509.22887v1)
- [Theory of Mind in Large Language Models: Assessment and Enhancement — ACL 2025 Long 1522](https://aclanthology.org/2025.acl-long.1522.pdf)
- [LLMs achieve adult human performance on higher-order theory of mind tasks — Frontiers in Human Neuroscience 2025](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2025.1633272/full)

### 3.6 Long-term memory: reflective summarization + weighted KG beats fixed retrieval

Two 2025 papers converge on the same architecture for long-term memory:
- **Reflective Memory Management** (ACL 2025 Long 413): instead of fixed
  embedding retrieval, the model periodically *reflects* on recent
  conversation and decides what to add/update/delete in the memory
  store, and retrieval is adaptively-granular.
- **Memoria** (arxiv 2512.12686): dynamic session-level summarization +
  weighted knowledge graph with edge weights that decay and reinforce
  based on recall patterns.

Both outperform standard RAG on LoCoMo (the long-conversation benchmark).

For Dodami's callback-memory problem: the winning architecture is NOT
"embed every turn, retrieve top-k". It's:
1. After every session, run a "reflect" pass that extracts 3-5
   callback-worthy moments as structured entries (topic, kid-affect,
   Dodami-response, one-line summary).
2. Maintain a small (20-50 entry) per-kid memory graph with recency and
   access-count weights.
3. At session start, retrieve the top 3-5 entries by "match current
   context + high weight" and inject them into `<callback_memory>`.

→ Dodami: our current callback memory plan (per project_content_design_rework.md)
can implement this architecture directly. Critical detail: the "reflect"
pass should happen *offline, between sessions*, not during the live turn —
Haiku can't afford that latency, and a cheaper model (Solar mini, or even
rule-based extraction) is fine because it's async.

Sources:
- [Reflective Memory Management for Long-term Dialogue — arxiv 2503.08026 / ACL 2025 Long 413](https://arxiv.org/pdf/2503.08026)
- [Memoria: A Scalable Agentic Memory Framework for Personalized Conversational AI — arxiv 2512.12686](https://arxiv.org/abs/2512.12686)
- [Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo) — arxiv 2402.17753](https://arxiv.org/abs/2402.17753)

### 3.7 Humor generation: LLMs default to shallow puns; the fix is a seeded-template corpus

2025 humor research (multiple papers converged on the same finding):
frontier LLMs produce fluent humor but default to clichéd wordplay and
fail at surprise. GPT-4.1, Gemini 2.5 Pro, Claude Sonnet 4 all tested;
all scored ~15% on PunnyPattern (a harder pun benchmark) vs ~83% on
standard pun datasets. The failure mode is over-use of pun scaffolds
the model has seen many times ("Why did X..." "Because Y...").

Practical fix for kid-facing Korean humor: *don't ask the model to
generate humor from scratch*. Instead, maintain a curated pool of
30-50 kid-tested Korean jokes/아재개그/언어유희 per persona, and have the
model *select-and-contextualize* one at the right moment. The selection
is the magic; the joke is vetted.

Additionally, the "Can AI Take a Joke—Or Make One?" study (ACM C&C 2025)
concludes humor generation in emotionally-grounded applications should
be human-AI collaboration: humans supply candidates, LLM picks timing
and adaptation. Matches our pilot UX — we want *the right joke at the
right moment*, not novel joke composition.

→ Dodami: build a per-persona `humor_bank` of 30-50 vetted jokes tagged
by (topic, age-appropriateness 6-15 subranges, emotional-state-fit).
The turn planner selects one when (a) a rule fires ("kid gave right
answer 3x in a row", "tension breaker needed", "transition between
activities") AND (b) the emotion-state classifier allows it. Model
picks and adapts, doesn't invent.

Sources:
- [Pun Unintended: LLMs and the Illusion of Humor Understanding — ACL EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1419.pdf)
- [Can AI Take a Joke—Or Make One? — ACM C&C 2025](https://dl.acm.org/doi/10.1145/3698061.3734388)
- [HumorBench: Probing Non-STEM Reasoning Abilities — arxiv 2507.21476](https://arxiv.org/html/2507.21476v1)

---

## 4. Children's conversational AI research — what kids 6-15 actually need

### 4.1 Moxie (Embodied AI): vocabulary scaffolding via licensed kid-dictionary

Moxie — the 5-10yo social robot — partnered with Merriam-Webster to integrate
the *Dictionary for Children* specifically so the LLM has age-appropriate
definitions to fall back on when a word lookup is needed. This is a
concrete anti-drift mechanism: rather than trusting the LLM to generate
kid-appropriate vocabulary explanations, it has a vetted source. Moxie's
"missions" (their term for scripted activity arcs) are written with
child-learning-specialist-authored scaffolding, not free-generated.

The pattern that transfers: *authored content + LLM glue, not LLM
generation all the way down*. Moxie's team is small on AI researchers
and large on OT (occupational therapists) and child-dev specialists;
the magic comes from curated missions, not model scale.

→ Dodami: for the TELL-mode content design already planned
(project_content_design_rework.md), hire or partner for authored content
— age-6/9/12/15 activity arcs with pre-written beats the LLM interpolates
between. The LLM is the glue, not the author. Specifically, partner or
license a Korean kid vocab bank (could start with 국립국어원 공공저작물)
for lookups rather than trusting Haiku to know age-appropriate Korean.

Sources:
- [Moxie: The Future of Child-Friendly AI in Education and Emotional Development — Prodigifirm](https://prodigifirm.com/blog/moxie-by-embodied/)
- [Moxie Conversational AI Robot Teaches Children Kindness — Sama Podcast](https://www.sama.com/podcast/moxie-the-robot-teaches-children-kindness-conversational-ai-child-development)
- [Embodied, Inc Launches Moxie — Unite.AI](https://www.unite.ai/embodied-inc-launches-moxie-a-robot-promoting-cognitive-learning-in-children/)

### 4.2 MIT Cognimates: kids as design partners, "inverse teaching" patterns

Cognimates (MIT Media Lab, Stefania Druga et al.) works with 7-14yo kids
as design partners, not test subjects. Their published finding that
transfers directly to Dodami: *kids respond most engagingly when they
are teaching the AI, not being taught by it*. A kid-AI interaction
framed as "help me understand this" generates more turns, more
elaboration, and more retention than "let me explain this to you".

Related: the "My Doll Says It's OK" study (Williams, Vazquez, Druga,
Maes, Breazeal) found voice-enabled toys materially influence children's
moral decisions — kids take the AI's judgment more seriously than adult
researchers initially expected. This is a design responsibility: Dodami
will be taken at face value by young kids on matters where we don't
want to be authority.

→ Dodami: two concrete adjustments. (a) Add a "kid-teaches-Dodami"
activity mode — the 4 personas each have areas where they "forget" and
the kid helps. Hooks curiosity, reverses power dynamic, drives more
turns. (b) Audit safety for "kids will believe us on things we don't
want them to" — specifically opinion/taste/moral questions. Default
stance: "난 잘 모르겠어, 너는 어떻게 생각해?"

Sources:
- [Project Overview — Cognimates, MIT Media Lab](https://www.media.mit.edu/projects/cognimates/overview/)
- [Growing up with AI — MIT Media Lab](https://www-prod.media.mit.edu/publications/growing-up-with-ai/)
- [Kids teach AI a little humanity with Cognimates — MIT Media Lab](https://www.media.mit.edu/posts/kids-teach-ai-a-little-humanity-with-cognimates/)

### 4.3 Adaptive scaffolding theory — ZPD + evidence-centered design for LLM agents

Park et al. 2025 (arxiv 2508.01503, "A Theory of Adaptive Scaffolding for
LLM-Based Pedagogical Agents") formalizes a framework combining three
things:
- **Zone of Proximal Development (ZPD, Vygotsky)**: the learner can do X
  alone, can do X+1 with help, can't do X+2 yet. Target X+1.
- **Evidence-Centered Design (ECD)**: every tutor move should produce
  evidence that updates the learner model.
- **Social Cognitive Theory**: self-efficacy drives continued engagement.

Operationalized into a dialogue loop:
1. **Diagnose** current level from recent turns (evidence).
2. **Target** one level up.
3. **Fade** support as success accumulates; re-scaffold when struggle detected.

Park's critical finding: LLM tutors that *fade* support outperform LLMs
that maintain constant support. Constant-support LLMs create learned
helplessness and kid-disengagement signals indistinguishable from
boredom.

→ Dodami: This matches kim_meeting_results.md's ZPD 3-state model that
김찬우 교수 agreed with. Implement it as explicit prompt state: the
per-turn injection includes `<zpd_state>current|emerging|mastered</zpd_state>`
per current skill, and Dodami's behavior branches: `current` → simpler
scaffolding, `emerging` → less support + questioning, `mastered` → move
to next skill or step back and let kid lead. This is THE research-backed
answer to "the kid masters something and Dodami keeps patronizing them",
which is one of the magic-killers.

Related work on dialogic reading with LLMs found parent-led dialogic
reading and AI-guided dialogic reading produce similar learning gains
when the AI uses adaptive follow-up prompts ("why do you think...",
"what do you notice...") — structured open-endedness, not content
delivery.

Sources:
- [A Theory of Adaptive Scaffolding for LLM-Based Pedagogical Agents — arxiv 2508.01503](https://arxiv.org/abs/2508.01503)
- [LLM Agents for Education: Advances and Applications — arxiv 2503.11733](https://arxiv.org/html/2503.11733v1)
- [Parent-led vs. AI-guided dialogic reading — BJET 2025](https://bera-journals.onlinelibrary.wiley.com/doi/10.1111/bjet.13615)
- [Asking, Playing, Learning: Investigating LLM-Based Scaffolding in Digital Game-Based Learning for Elementary AI Education — Gong et al., Sage 2025](https://journals.sagepub.com/doi/10.1177/07356331251396354)

### 4.4 CEFR-annotated vocabulary grounding (kid-proficiency-aware word choice)

A specific 2025 finding worth applying: "Despite the growing capabilities
of LLMs, they do not yet possess the ability to limit their vocabulary to
levels appropriate for younger age groups." The CEFR-annotated WordNet
paper (arxiv 2510.18466) addresses this for English by tagging each word
sense with a CEFR level (A1-C2), letting the model filter to senses at or
below the user's level.

Korean equivalent: 한국어교육과정 (Korean-as-a-foreign-language curriculum)
has 1–6 level bands with published vocabulary lists per level
(국립국어원 / 세종학당). Heritage/L1 kid levels map approximately:
- Age 6 ≈ TOPIK 초급 1-2 vocab (~1500 words).
- Age 9 ≈ TOPIK 중급 3-4 vocab (~3000 words).
- Age 12-15 ≈ TOPIK 고급 5-6 vocab (~6000 words).

→ Dodami: ship a per-age vocabulary whitelist (or soft guide via system
prompt: "Prefer words from TOPIK level ≤N for kid aged X. If you must use
a word above that level, gloss it in the same breath."). This is simpler
than CEFR-annotating all of Korean and uses public curricula.

Sources:
- [CEFR-Annotated WordNet: LLM-Based Proficiency-Guided Semantic Database for Language Learning — arxiv 2510.18466](https://arxiv.org/html/2510.18466v2)
- [Evaluating LLMs on Generating Age-Appropriate Child-Like Conversations — arxiv 2510.24250](https://arxiv.org/html/2510.24250)

### 4.5 KAIST + NAVER + Dodakim — "AAcessTalk" (Korean, CHI 2025 Best Paper)

Directly relevant precedent: AAcessTalk (KAIST + NAVER AI Lab + Dodakim
Child Development Center) won the ACM CHI 2025 Best Paper Award. It's an
AI-driven communication tool bridging children with autism and their
parents. The research contribution most relevant to Dodami: they designed
turn-taking and scaffolding specifically for Korean child speech patterns
(slower turn-rate, more non-verbal cues, parent-mediated turns). Korean
child pragmatics are not just English-kid pragmatics translated.

The broader KAIST AI finding (their virtual TA deployment) also applies:
grounding LLM responses in curated course material (retrieval from
approved sources) materially outperforms pure-LLM responses for
kid-facing educational use. Trust goes up; hallucination goes down.

→ Dodami: (a) look up AAcessTalk's published paper for their exact
turn-taking parameters (kid-pause tolerance, back-channel timing) —
may directly inform predictive barge-in v2 tuning. (b) Default to
grounded-retrieval for any factual claim Dodami makes; hallucinated
facts to a kid is a trust-destroyer and parent-opinion killer
(project_pilot_first_reactions.md shows how fragile parent trust is —
이현's mom bounced on TTS voice alone).

Sources:
- [KAIST × NAVER AI Lab × Dodakim AAcessTalk — KAIST News](https://www.kaist.ac.kr/newsen/html/news/?mode=V&mng_no=44370)
- [KAIST AI teaching assistant — Korea Herald](https://www.koreaherald.com/article/10505878)

### 4.6 Characterizing LLM story-reading for children — "parent-as-co-user" is the real UX

Wang et al. 2025 (arxiv 2503.00590) did multi-stakeholder interviews with
kids, parents, and educators using LLM-based story-reading for kids. Their
headline finding: *parents are the primary adopter/retention driver, not
kids*. Parents assess AI tools against their own mental model of "good
parenting," and if the AI contradicts that model, they pull the plug —
regardless of whether the kid liked it.

This matches Dodami's actual pilot data exactly (이현's mom, 왕대표's wife
— project_parent_willingness_to_pay.md, project_pilot_first_reactions.md).
The research adds a concrete design consequence: *surface what Dodami
did during a session to parents* via explicit parent-facing summaries,
and let parents configure guardrails. Both Moxie and Cognimates do this
and it's not accidental.

→ Dodami: post-session parent summary is a higher-leverage feature than
any Dodami-side prompt improvement for retention. One-paragraph "today
태은 did X, struggled with Y, we adjusted by Z" — readable in <30 seconds.
Matches the admin dashboard but for parents specifically
(project_admin_dashboard.md lists admin dashboard, not parent dashboard —
probably the gap).

Source: [Characterizing LLM-Empowered Personalized Story-Reading and Interaction for Children: Insights from Multi-Stakeholder Perspectives — arxiv 2503.00590](https://arxiv.org/html/2503.00590v1)

---

## 5. Korean conversational style

### 5.1 반말 / 존댓말 dynamics — the register signal is multi-dimensional, not binary

The pragmatic literature (and Kory Korean docs, and Naver's own learn-Korean
chatbot products) treat 반말/존댓말 as a binary — friend vs. stranger/elder.
For kid-facing AI, that's too coarse. The more useful decomposition from
Korean-language-teaching literature:
- **Register choice**: 반말 default with 6-12yo, 해요체 (informal polite)
  by default with 13-15yo who may want to be treated as older.
- **Terminal particle**: 반말 alone is flat; 반말 + warm particles
  (~어/~야/~구나/~네/~거든/~잖아) carries warmth and age-peer intimacy.
- **Address term**: the model's choice of 2nd-person reference
  (name-use vs. 너 vs. zero-anaphora) signals intimacy level
  independently of register.
- **Sentence-final intonation (voice)**: rising contour = question
  and softens a statement; falling contour = assertion/correction.

Kids are sensitive to all four. An AI that defaults to 반말 but drops
warm particles sounds cold ("해" vs. "했어~"). An AI that uses 너 on every
turn sounds formal or even slightly confrontational; using the kid's
name (once per 2-3 turns) sounds personal.

→ Dodami: system prompt shouldn't say "use 반말" and stop there. It
should specify all four dimensions with examples:
- Default register: 반말 (6-12), 해요체 (13-15, kid-configurable to 반말).
- Warm particles: required, at least one per turn. Preferred:
  ~어 (declarative), ~야 (vocative/exclamation), ~구나 (discovery),
  ~잖아 (shared-knowledge), ~거든 (reveal/explain).
- Address: kid's name every 2-3 turns; zero-anaphora otherwise; avoid
  너 except in casual-challenge contexts.
- Intonation hint for TTS: 3-sentence response should be low-high-low
  (assert → invite → hand-back).

Sources:
- [존댓말(high) & 반말(low) — Kory Korean](https://korykorean.com/docs/basic00/polite-and-casual)
- [Evaluating Large Language Models on Understanding Korean Indirect Speech Acts — arxiv 2502.10995](https://arxiv.org/html/2502.10995v1)
- [How implementing an AI chatbot impacts Korean as a foreign language learners' willingness to communicate in Korean — System Journal 2024](https://www.sciencedirect.com/science/article/pii/S0346251X24000381)

### 5.2 Korean indirect speech act handling — where LLMs fail, and where Claude leads

The 2025 paper "Evaluating LLMs on Understanding Korean Indirect Speech Acts"
(arxiv 2502.10995) tested all frontier models on Korean sentences where
literal meaning ≠ intended meaning (indirect requests, sarcasm, softened
refusals). Results:
- Claude 3 Opus: 71.94% MCQ, 65% OEQ — **best overall**.
- HyperCLOVA X: strong on Korean-specific items.
- GPT-4, Gemini: lower.
- Human baseline: ~90%+.

Two concrete implications for Dodami:
1. Haiku 4.5 inherits (probably reduced but present) Claude-family Korean
   indirect-speech handling strength. This is defensible architectural
   choice — not just because Haiku is cheap, but because Anthropic models
   are literally the best-tested on this skill for Korean.
2. The gap to human (90%) is still large. Kid utterances are indirect
   at adult-level rates (maybe higher, due to shyness, incomplete
   vocabulary, and intentional vagueness). A misread indirect-speech
   turn is a magic-killer because it feels like "the AI doesn't get me".

Concrete safeguard: when the incoming utterance is short (<= 4 words) and
the last Dodami turn was content-heavy, treat it as potentially indirect.
Default interpretation should be "kid is partially engaged, hasn't decided
what to say" — not "kid wants me to do literally what they said."

→ Dodami: instrument the pilot logs to classify % of kid turns that are
plausibly indirect speech acts, and audit Dodami's responses on those.
Likely a top-3 magic-gap source (behind persona flatness and pace issues).

Sources:
- [Evaluating LLMs on Understanding Korean Indirect Speech Acts — arxiv 2502.10995](https://arxiv.org/html/2502.10995v1)

### 5.3 애교 (aegyo) — yes or no? The linguistics says "no, but the substructure yes"

The linguistic register of aegyo (Moon, under-review Stanford; Puggaard-Rode &
Shin, ScienceDirect 2020; Krayem 2019 "Korean Cuties") has documented features:
- Rising-falling intonation (LHL%).
- Nasality ("~ㅁ" additions, nasal tone).
- Infantile consonants (혀 짧은 소리, stopping/affrication of fricatives).
- Vowel lengthening on key syllables.
- Addition of softening diminutives (~뿌이, ~뽕, ~이).

Important finding: aegyo is *not child-directed speech*. It's a performed
register that adults use toward intimates, humor, deference. Actual
child-directed speech in Korean is simpler, warmer, slower — but *not*
nasal or lisping. If Dodami defaults to aegyo, older kids (11+) will find
it cringe. If it defaults to flat 반말, it feels cold.

The right target register for Dodami is what the linguistic literature
calls **peer-intimate 반말 with warmth particles** — not aegyo, not
formal, not baby-talk. The TTS voice (Sona 2 Flash + Coco per
project_tts_decision.md) already biases the acoustic side. The prompt
needs to match the lexical side.

→ Dodami: explicitly *forbid* aegyo markers in the system prompt
(no "~뿌이", no lisp spelling, no excessive "~앙"). Instead *require*
warmth particles (5.1 list) in every response. Provide 3 few-shot
examples of "warm 반말 that is NOT aegyo" so the model can distinguish.
This is age-bracket safe — both 6yo and 14yo tolerate it, while
aegyo collapses at ~10yo for Korean kids.

Sources:
- [How cute do I sound to you?: gender and age effects in the use and evaluation of Korean baby-talk register, Aegyo — Puggaard-Rode & Shin, ScienceDirect 2020](https://www.sciencedirect.com/science/article/abs/pii/S0388000120300218)
- [Linguistic resources of aegyo and its media assessments — Moon, Stanford](https://web.stanford.edu/~eckert/Courses/l1562018/Readings/MoonUnderReview.pdf)
- [Korean Cuties: Understanding Performed Winsomeness (Aegyo) — Krayem, Asia Pacific Journal of Anthropology 2018](https://www.tandfonline.com/doi/abs/10.1080/14442213.2018.1477826)
- [The Phonetics of Nasal Cuteness in Korean AEGYO — Crosby, U. South Carolina](https://scholarcommons.sc.edu/context/etd/article/8220/viewcontent/Crosby_sc_0202A_18870.pdf)

### 5.4 HyperCLOVA X safety and KoSBi — a reusable public Korean safety filter

Naver published KoSBi — a Korean social-bias dataset and classifier — as
part of HyperCLOVA X's safety pipeline. It measurably reduces unsafe
generation by 16.47% when used as a pre-response filter. Open-dataset
availability means we can evaluate Dodami outputs against the same filter,
or train a small classifier on top.

Relevance to Dodami: our current safety stack is fail-closed but relies
on Anthropic's built-in filters + our custom Korean Tier-1/2 rules
(project_dodami_safety_fix_2026_04_17.md, project_chanhyuk_greeting_safety_fp.md).
KoSBi covers social-bias categories (age, gender, region, disability,
appearance) that our Tier-1 doesn't currently handle. This is where
"kid says something biased, Dodami mirrors it" risks.

→ Dodami: evaluate KoSBi as an additional offline eval set — run the
last N Dodami turns through a KoSBi classifier once a day and surface
any flagged turns in the admin dashboard. Low cost, high-value parent-trust
signal.

Sources:
- [HyperCLOVA X Technical Report — arxiv 2404.01954](https://arxiv.org/html/2404.01954v1)
- [Meet South Korea's LLM Powerhouses: HyperCLOVA, AX, Solar Pro — MarkTechPost](https://www.marktechpost.com/2025/08/21/meet-south-koreas-llm-powerhouses-hyperclova-ax-solar-pro-and-more/)
- [naver-hyperclovax — HuggingFace](https://huggingface.co/naver-hyperclovax)

### 5.5 Kakao, Upstage — what each published publicly

The 2025 Korean sovereign-AI initiative chose 5 firms (Naver, LG, SK, NC,
Upstage). Kakao and KT dropped in round 2. Published work from each
relevant to Dodami:
- **Naver** (HyperCLOVA X): above; strong Korean kid-research partnerships
  (AAcessTalk, Dodakim Child Development Center).
- **Upstage** (Solar): Solar Pro is competitive on Korean benchmarks;
  we already use it as fallback judge (project_llm_migration_decisions.md).
  Upstage has published less prompt-engineering-style guidance than Naver.
- **LG AI Research** (Exaone): strong on Korean scientific text, weaker on
  dialogue. Probably not Dodami-relevant for conversational style.
- **Kakao** (KoGPT): dropped from sovereign-AI, but Kakao's Brain division
  has published kid-chat guardrail work; couldn't find a directly
  usable paper in the 2025-2026 window.

Pattern takeaway: **Naver is the main Korean vendor publishing
child-conversational-AI research**. For Dodami-specific Korean prompting
techniques, Naver AI Lab's papers (via arxiv and CHI) are the highest
signal; the other Korean labs are focused on foundation models, not
conversational agents.

→ Dodami: monitor the Naver AI Lab and Dodakim Child Development Center
for ongoing publications. This is our most-aligned Korean research
source.

Sources:
- [Naver, LG, SK, NC, Upstage named to build S.Korea's sovereign AI model — KED Global](https://www.kedglobal.com/artificial-intelligence/newsView/ked202508040010)
- [Meet South Korea's LLM Powerhouses — MarkTechPost](https://www.marktechpost.com/2025/08/21/meet-south-koreas-llm-powerhouses-hyperclova-ax-solar-pro-and-more/)

---

## 6. Multi-turn generation architectures — how Pi, ChatGPT voice, Gemini Live, Character.ai actually deliver pacing

### 6.1 Pi (Inflection) — conversational-pacing feature + 100-turn memory + sentiment-first pipeline

Pi's distinctive architectural choice, as published in their materials:
- **Conversational pacing** — adapts response length and complexity per
  user's interaction pattern. Short utterances → short responses. Long
  musings → longer thoughtful responses. Explicit mirroring of user
  energy.
- **Up to 100 conversational turns** of explicit memory.
- **Recursive Sentiment Loop** — sentiment is analyzed *before* response
  generation, not as a post-hoc filter. The sentiment classifier
  conditions the response style.
- **Adaptive communication engine** — tone-matches (formality,
  enthusiasm, emotional expression).

The key insight for Dodami: **sentiment-first is counter-intuitive but
correct**. Most voice agents do STT → LLM → sentiment/safety → TTS.
Pi does STT → sentiment → LLM-conditioned-on-sentiment → TTS. The LLM
sees the user's emotional state as an explicit input, not as text-only.

→ Dodami: add a lightweight sentiment classifier (we already have 김찬우
 affect cues from 태은 session) as a pre-LLM step. Feed `<user_sentiment>`
explicitly into the Haiku prompt as a separate field. Don't rely on Haiku
to re-derive sentiment from the utterance text — it's both redundant (costs
reasoning budget) and less accurate than a specialized classifier.

Sources:
- [Pi AI Chatbot: Ultimate Guide to Features & Privacy — Skywork.ai](https://skywork.ai/blog/pi-ai-chatbot-ultimate-guide/)
- [Is Inflection AI's Pi the Most Human AI Assistant? — Sider](https://sider.ai/blog/ai-tools/is-inflection-ai-s-pi-the-most-human-ai-assistant-an-in-depth-review)
- [Inflection 3 Pi Free Chat Online — Skywork.ai](https://skywork.ai/blog/models/inflection-3-pi-free-chat-online/)
- [Inflection AI — Wikipedia](https://en.wikipedia.org/wiki/Inflection_AI)

### 6.2 ChatGPT Realtime / gpt-realtime — speech-to-speech with adaptive length prediction

OpenAI's `gpt-realtime` (production voice-agent GA, Sep 2025) is multimodal
speech-to-speech — raw audio in, raw audio out, no intermediate text. Key
architectural features:
- Sub-300ms response latency (sometimes sub-100ms for trivial turns).
- **Adaptive response length prediction**: model estimates conversational
  pacing and automatically shortens or extends based on detected speech
  patterns.
- **Phrase endpointing and turn detection** handled natively.
- **Interruption support** — user can barge in; model stops and reroutes.
- Either WebSocket or WebRTC transport.

What transfers to Dodami without going full-S2S (which we aren't, per
project_cloud_migration_plan.md):
- The *length-prediction* pattern can be simulated with a pre-classifier
  ("should this turn be 1 beat or 3 beats?") that routes to different
  prompts.
- The *interruption* handling is already in Dodami (VAD + predictive
  barge-in v1 per project_vad_endpointing_v1.md).
- The *turn-detection confidence* signal is something we could expose as
  a prompt input — "kid is probably done / probably still thinking" — to
  bias whether Dodami jumps in at boundary or waits another beat.

→ Dodami: the biggest missing piece vs. gpt-realtime is *adaptive length
prediction*. Implement a turn-length classifier (again, regex + heuristics
fine): kid utterance length, semantic weight, emotional content → 1-beat
vs. 3-beat response target. Pass to Haiku as explicit constraint.

Sources:
- [Introducing gpt-realtime and Realtime API updates for production voice agents — OpenAI](https://openai.com/index/introducing-gpt-realtime/)
- [Realtime API — OpenAI API Docs](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Realtime API: The Missing Manual — Latent Space](https://www.latent.space/p/realtime-api)
- [OpenAI's gpt-realtime Enables Production-Ready Voice Agents — InfoQ](https://www.infoq.com/news/2025/09/openai-gpt-realtime/)

### 6.3 Gemini Live API — native-audio model, intonation-aware control

Google's Gemini Live API is also S2S (2.5 Flash Native Audio) but publishes
more about *prosody control* than OpenAI has. Specifically:
- Native model handles intonation, emphasis, pauses, pitch variation
  — not bolt-on TTS.
- User-facing pacing controls (speed, accent) are per-session.
- Interruption handling is described as "knows precisely when to respond
  and when to stay silent" — native turn-taking, not heuristic VAD.

The lesson from Gemini's public materials: **prosody control is a
first-class control surface**, not a TTS afterthought. For Dodami's
cascade-stack (Whisper + Haiku + Sona 2 Flash), the TTS layer should
receive explicit prosody hints from the LLM turn: `{speed: fast, pitch:
high, pause_after: "야"}`. Haiku can emit these as side-channel annotations.

→ Dodami: extend the `<say>` block to allow SSML-lite annotations for
Sona 2. Specifically, encoded pauses (to create multi-beat within a
single response), speed changes (faster-on-excitement, slower-on-empathy),
and pitch hints. This gives us Gemini-Live-style prosody control on a
cascade stack.

Sources:
- [Gemini Audio — Google DeepMind](https://deepmind.google/models/gemini-audio/)
- [How to use Gemini Live API Native Audio in Vertex AI — Google Cloud Blog](https://cloud.google.com/blog/topics/developers-practitioners/how-to-use-gemini-live-api-native-audio-in-vertex-ai)
- [Gemini Live audio updates help conversations feel more natural — Google Blog](https://blog.google/products/gemini/gemini-live-audio-updates/)
- [Improved Gemini audio models for powerful voice interactions — Google Blog](https://blog.google/products/gemini/gemini-audio-model-updates/)

### 6.4 Character.ai — persona-prompt + buffered turns + affective reranker

Character.ai architecture (from published emergentmind + infrastructure
notes) is closer to Dodami's reality:
- Character definition (name, backstory, traits, behavioral rules)
  prepended to each session prompt.
- Session-level buffer of 10-15 recent turns + summary embeddings for
  thematic continuity.
- Post-generation affective alignment classifier re-ranks candidate
  completions for emotional appropriateness.
- **Limitation**: no real cross-session memory, no multi-modal, no
  per-character persona re-writing.

The reranker pattern is the most interesting: generate 2-3 candidates,
rank by emotional fit, pick one. Cost is ~2x token but quality bump on
"feels right" is substantial — it's how Character.ai maintains
persona-feel despite the relatively weak underlying model they use.

→ Dodami: for high-stakes turns (end of activity, safety-sensitive,
emotional opener), generate 2 candidates and have a cheaper model
(Solar mini or Haiku itself with a different eval prompt) pick the one
that best matches the persona's emotion-state. Skip for small-talk turns
to keep latency. This is essentially a selective best-of-N with
character-fit as the judge.

Sources:
- [Character.AI: AI Companion Platform — Emergent Mind](https://www.emergentmind.com/topics/character-ai-c-ai)
- [AI Roleplay Custom Persona: Building Dynamic Characters with Persistent Memory — Jenova](https://www.jenova.ai/en/resources/ai-roleplay-custom-persona)
- [How to Make Character.AI Memory Better — AI Agent Memory Org](https://aiagentmemory.org/articles/how-to-make-character-ai-memory-better/)

### 6.5 Sequential Pipeline vs. Speech-to-Speech — the hybrid Dodami should actually build

LiveKit's "Sequential Pipeline Architecture for Voice Agents" and Softcery's
comparison both conclude that the right architecture depends on use case:
- **S2S (speech-to-speech)**: lowest latency (200-300ms), but loses explicit
  text transcripts, harder to audit, harder to inject custom logic between
  STT and LLM.
- **Cascade (STT → LLM → TTS)**: higher latency (500-1000ms), but each
  stage is swappable, testable, observable, and injectable.

LiveKit's specific recommendation for *kid-facing* or *safety-sensitive*
deployments: **cascade with aggressive parallelization** — stream STT
partials to the LLM while user is still talking, start LLM generation
speculatively, flush if the user's final transcript differs from partial.
This gets to ~400ms effective latency while keeping the cascade's auditing
benefits.

→ Dodami: this is approximately what Dodami is already doing
(per project_predictive_barge_in_v1.md). The next optimization: stream
LLM tokens to TTS as they're generated (not wait for full response).
Sona 2 Flash supports streaming. Combined with the 3-beat plan (1.5
above) emitted as separate blocks, the first beat can start playing
while Haiku is still generating beats 2-3. Perceived latency drops
substantially.

Sources:
- [Sequential Pipeline Architecture for Voice Agents — LiveKit](https://livekit.com/blog/sequential-pipeline-architecture-voice-agents)
- [Real-Time (Speech-to-Speech) vs Turn-Based (Cascading STT/TTS) Voice Agent Architecture — Softcery](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture)
- [Voice Agent Infrastructure Stack 2026: Full Reference — Digital Applied](https://www.digitalapplied.com/blog/voice-agent-infrastructure-stack-2026-reference)
- [Optimizing Voice Agent Barge-in Detection for 2025 — Sparkco](https://sparkco.ai/blog/optimizing-voice-agent-barge-in-detection-for-2025)
- [How to Evaluate Voice Agents in 2025: Beyond ASR and WER — MarkTechPost](https://www.marktechpost.com/2025/10/05/how-to-evaluate-voice-agents-in-2025-beyond-automatic-speech-recognition-asr-and-word-error-rate-wer-to-task-success-barge-in-and-hallucination-under-noise/)

### 6.6 Backchanneling and filler sounds — a real technique, not a gimmick

"Backchanneling involves incorporating subtle cues like 'uh-huh' and 'got
it' to create a more natural and engaging conversation flow" — now a
standard pattern in voice-agent literature (Sparkco 2025, LiveKit,
VoiceInfra guide). The production rule: fire a quick ("음~" or "응?"
equivalent) as soon as barge-in is detected, covering the 200-400ms before
the actual LLM response starts.

This is what project_fillers_design.md is already building. The research
validation: it directly addresses the "latency masking" problem that
otherwise dominates perceived presence. It's also the #1 feature
distinguishing feel-like-human voice agents from feel-like-robot ones in
recent A/B studies.

Korean backchannels are specific and different from English:
- "응" / "응?" / "어" / "어?" / "아~" (listening acknowledgments).
- "음~" / "어~" (thinking-out-loud).
- "그래?" / "진짜?" (engaged surprise).
- "아, 그렇구나" (comprehension acknowledgment).

Each maps to a different dialogue function. The filler bank should be
tagged by function, and the trigger rule picks by context.

→ Dodami: project_fillers_design.md (102-phrase bank) is the exact right
move. Tag each filler by:
(a) function (listen / think / react / comprehend),
(b) emotion (neutral / excited / gentle / surprised),
(c) persona compatibility (which of the 4 personas uses it).

Sources:
- [Optimizing Voice Agent Barge-in Detection for 2025 — Sparkco](https://sparkco.ai/blog/optimizing-voice-agent-barge-in-detection-for-2025)
- [Voice AI Prompt Engineering: Complete Technical Guide — VoiceInfra](https://voiceinfra.ai/blog/voice-ai-prompt-engineering-complete-guide)
- [Real-Time Barge-In AI for Voice Conversations — Gnani](https://www.gnani.ai/resources/blogs/real-time-barge-in-ai-for-voice-conversations-31347)

### 6.7 Script-based + LLM — the "AI therapist" pattern for bounded activities

"Script-Based Dialog Policy Planning for LLM-Powered Conversational Agents"
(arxiv 2412.15242) describes an architecture where a deterministic
finite-state "script" defines activity progression (state A → B → C), and
the LLM is used only to generate the *surface form* of each state's
utterance. This constrains LLM behavior in bounded activities (therapy
session, tutoring drill, safety redirect) while keeping the conversational
feel.

For Dodami, this is the natural architecture for TELL-mode and activity
arcs:
- Activity = script with 5-10 states and transition conditions.
- LLM generates the surface utterance at each state.
- Scripts are authored by domain experts (reuse the Moxie pattern from
  4.1).

The "magic" of free-form conversation remains on the edges (small talk
between activities, openings, closings) while the educational content
gets the reliability of authored scripts.

→ Dodami: after the TELL-mode redesign, frame the activity arcs as
scripts — explicit state machines with LLM-filled surface. Gives parent
trust (they can see what Dodami is "doing"), gives eng team debuggability
(which state was the kid in when X happened), gives the LLM less room to
drift.

Source: [Script-Based Dialog Policy Planning for LLM-Powered Conversational Agents — arxiv 2412.15242](https://arxiv.org/html/2412.15242v1)

### 6.8 Pre-Act pattern — plan, then speak

Pre-Act (arxiv 2505.09970) formalizes the "plan before respond" pattern:
the agent generates a multi-step execution plan *with reasoning per step*
before generating the user-facing response. Each step carries forward
previous-step context. Reported improvements on multi-turn
tool-use benchmarks are material.

For Dodami's voice-first constraint, the generation can't be too slow,
but a *micro-plan* is within budget: <plan> block with 2-3 beats,
<say> block with the Korean surface form. The plan guides the say, and
we can optionally log the plan for debugging without exposing to the
kid. We already discussed this in 1.5; Pre-Act is the research
validation that this pattern is the right shape.

→ Dodami: ship the <plan>/<say> split in the Haiku prompt. Make the
<plan> terse (function over prose) — 3 short labels is enough:
`<plan>acknowledge_frustration | simpler_reframe | invite_retry</plan>`.
The model converts this to fluent Korean in <say>.

Source: [Pre-Act: Multi-Step Planning and Reasoning Improves Acting in LLM Agents — arxiv 2505.09970](https://arxiv.org/html/2505.09970)

---

## Cross-cutting synthesis: the "ship order" for Dodami Magic

Not a recommendation (that's the charter's job), but the research across
the six streams converges on a clear priority:

1. **Prompt restructure** (section 1): XML tags, role/style split,
   few-shot examples with side-by-sides, prompt caching with a
   persona/session/turn split. **Immediate.**
2. **Turn-type classifier + routed prompts** (2.3, 6.2): short 1-beat
   vs. 3-beat response targets. **1 day of work.**
3. **Plan/say split** (1.5, 6.8): multi-beat structure with
   hidden planning. **1 day of work.**
4. **Dialogue-act + emotion-state tracking** (3.2, 3.3, 3.5, 6.1):
   running-act list + per-persona emotion states + user-sentiment
   pre-classifier. **2-3 days.**
5. **Korean register precision** (5.1, 5.3): explicit warm-particle
   requirement, aegyo ban, age-appropriate vocabulary. **1 day.**
6. **Reflective callback memory** (3.6): offline per-session reflect
   pass → per-kid graph → session-start retrieval. **1 week (orthogonal
   to content redesign).**
7. **Humor and content banks** (3.7, 4.1): curated 30-50 joke bank +
   authored activity scripts. **Content authoring work, 2-3 weeks.**
8. **Prosody side-channel** (6.3): SSML-lite annotations from Haiku to
   Sona 2. **1-2 days once Sona 2 streaming is wired up.**
9. **Parent dashboard** (4.6): post-session summary for retention.
   **Feature-sized, 1 week.**

The research bias: steps 1-5 are prompt-level changes to an existing
stack; steps 6-9 involve new content/infra. Prompt-level changes are
expected to move the needle substantially for free.

---

## Appendix: sources recap (flat list, alphabetized by domain)

### Anthropic
- [Adaptive thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking)
- [Building with extended thinking — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Giving Claude a role with a system prompt](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/system-prompts)
- [Keep Claude in character with role prompting and prefilling](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/keep-claude-in-character)
- [Prompt caching — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Prompt caching with Claude — Anthropic News](https://www.anthropic.com/news/prompt-caching)
- [Prompt engineering overview — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)
- [Prompting best practices — Claude API Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
- [The "think" tool: Enabling Claude to stop and think — Anthropic Engineering](https://www.anthropic.com/engineering/claude-think-tool)
- [Use XML tags to structure your prompts — Claude API Docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags)
- [Using Examples (Few-Shot Prompting) — AWS prompt-engineering-with-anthropic-claude-v-3](https://github.com/aws-samples/prompt-engineering-with-anthropic-claude-v-3/blob/main/07_Using_Examples_Few-Shot_Prompting.ipynb)

### OpenAI
- [GPT-5 prompting guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide)
- [GPT-5.1 Prompting Guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5-1_prompting_guide)
- [GPT-5.2 Prompting Guide — OpenAI Cookbook](https://cookbook.openai.com/examples/gpt-5/gpt-5-2_prompting_guide)
- [GPT-5.4 Prompt guidance — OpenAI API](https://developers.openai.com/api/docs/guides/prompt-guidance)
- [Introducing gpt-realtime and Realtime API updates for production voice agents — OpenAI](https://openai.com/index/introducing-gpt-realtime/)
- [Realtime API — OpenAI API Docs](https://platform.openai.com/docs/guides/realtime)
- [OpenAI Realtime API: The Missing Manual — Latent Space](https://www.latent.space/p/realtime-api)

### Google / Gemini
- [Gemini Audio — Google DeepMind](https://deepmind.google/models/gemini-audio/)
- [Gemini Live API available on Vertex AI — Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/gemini-live-api-available-on-vertex-ai)
- [Gemini Live audio updates help conversations feel more natural — Google Blog](https://blog.google/products/gemini/gemini-live-audio-updates/)
- [Improved Gemini audio models for powerful voice interactions — Google Blog](https://blog.google/products/gemini/gemini-audio-model-updates/)

### Academic (dialogue, ToM, memory, humor, scaffolding)
- [A Survey on Multi-Turn Interaction Capabilities of Large Language Models — arxiv 2501.09959](https://arxiv.org/html/2501.09959v1)
- [Beyond Single-Turn: A Survey on Multi-Turn Interactions with Large Language Models — arxiv 2504.04717](https://arxiv.org/abs/2504.04717)
- [Consistently Simulating Human Personas with Multi-Turn Reinforcement Learning — arxiv 2511.00222 (NeurIPS 2025)](https://arxiv.org/abs/2511.00222)
- [Enhancing Character-Coherent Role-Playing Dialogue with a Verifiable Emotion Reward — MDPI Information 16/9/738](https://www.mdpi.com/2078-2489/16/9/738)
- [GraphIF: Enhancing Multi-Turn Instruction Following — arxiv 2511.10051](https://arxiv.org/html/2511.10051v2)
- [FlowKV: Enhancing Multi-Turn Conversational Coherence — arxiv 2505.15347](https://arxiv.org/html/2505.15347v1)
- [Reflective Memory Management for Long-term Dialogue — arxiv 2503.08026 / ACL 2025](https://arxiv.org/pdf/2503.08026)
- [Memoria: A Scalable Agentic Memory Framework — arxiv 2512.12686](https://arxiv.org/abs/2512.12686)
- [Evaluating Very Long-Term Conversational Memory (LoCoMo) — arxiv 2402.17753](https://arxiv.org/abs/2402.17753)
- [RecToM: Evaluating Machine Theory of Mind in LLM-based Conversational Recommender Systems — arxiv 2511.22275](https://arxiv.org/abs/2511.22275)
- [Infusing Theory of Mind into Socially Intelligent LLM Agents — arxiv 2509.22887](https://arxiv.org/html/2509.22887v1)
- [Theory of Mind in Large Language Models: Assessment and Enhancement — ACL 2025 Long 1522](https://aclanthology.org/2025.acl-long.1522.pdf)
- [LLMs achieve adult human performance on higher-order theory of mind tasks — Frontiers Human Neuroscience 2025](https://www.frontiersin.org/journals/human-neuroscience/articles/10.3389/fnhum.2025.1633272/full)
- [Pun Unintended: LLMs and the Illusion of Humor Understanding — ACL EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1419.pdf)
- [HumorBench: Probing Non-STEM Reasoning Abilities — arxiv 2507.21476](https://arxiv.org/html/2507.21476v1)
- [Can AI Take a Joke—Or Make One? — ACM C&C 2025](https://dl.acm.org/doi/10.1145/3698061.3734388)
- [A Theory of Adaptive Scaffolding for LLM-Based Pedagogical Agents — arxiv 2508.01503](https://arxiv.org/abs/2508.01503)
- [LLM Agents for Education: Advances and Applications — arxiv 2503.11733](https://arxiv.org/html/2503.11733v1)
- [Characterizing LLM-Empowered Personalized Story-Reading — arxiv 2503.00590](https://arxiv.org/html/2503.00590v1)
- [CEFR-Annotated WordNet — arxiv 2510.18466](https://arxiv.org/html/2510.18466v2)
- [Evaluating LLMs on Generating Age-Appropriate Child-Like Conversations — arxiv 2510.24250](https://arxiv.org/html/2510.24250)
- [Pre-Act: Multi-Step Planning and Reasoning Improves Acting in LLM Agents — arxiv 2505.09970](https://arxiv.org/html/2505.09970)
- [Script-Based Dialog Policy Planning — arxiv 2412.15242](https://arxiv.org/html/2412.15242v1)
- [Parent-led vs. AI-guided dialogic reading — BJET 2025](https://bera-journals.onlinelibrary.wiley.com/doi/10.1111/bjet.13615)

### Korean-specific
- [Evaluating LLMs on Understanding Korean Indirect Speech Acts — arxiv 2502.10995](https://arxiv.org/html/2502.10995v1)
- [HyperCLOVA X Technical Report — arxiv 2404.01954](https://arxiv.org/html/2404.01954v1)
- [How cute do I sound to you? — Puggaard-Rode & Shin, ScienceDirect 2020](https://www.sciencedirect.com/science/article/abs/pii/S0388000120300218)
- [Linguistic resources of aegyo — Moon, Stanford](https://web.stanford.edu/~eckert/Courses/l1562018/Readings/MoonUnderReview.pdf)
- [Korean Cuties: Understanding Performed Winsomeness — Krayem 2018](https://www.tandfonline.com/doi/abs/10.1080/14442213.2018.1477826)
- [The Phonetics of Nasal Cuteness in Korean AEGYO — Crosby](https://scholarcommons.sc.edu/context/etd/article/8220/viewcontent/Crosby_sc_0202A_18870.pdf)
- [KAIST × NAVER AI Lab × Dodakim AAcessTalk — KAIST News](https://www.kaist.ac.kr/newsen/html/news/?mode=V&mng_no=44370)
- [KAIST AI teaching assistant — Korea Herald](https://www.koreaherald.com/article/10505878)
- [존댓말(high) & 반말(low) — Kory Korean](https://korykorean.com/docs/basic00/polite-and-casual)
- [How implementing an AI chatbot impacts Korean as a foreign language learners' willingness to communicate in Korean — System Journal 2024](https://www.sciencedirect.com/science/article/pii/S0346251X24000381)

### Children / Kids AI
- [Project Overview — Cognimates, MIT Media Lab](https://www.media.mit.edu/projects/cognimates/overview/)
- [Growing up with AI — MIT Media Lab](https://www-prod.media.mit.edu/publications/growing-up-with-ai/)
- [Kids teach AI a little humanity with Cognimates — MIT Media Lab](https://www.media.mit.edu/posts/kids-teach-ai-a-little-humanity-with-cognimates/)
- [Moxie: The Future of Child-Friendly AI in Education — Prodigifirm](https://prodigifirm.com/blog/moxie-by-embodied/)
- [Moxie Conversational AI Robot Teaches Children Kindness — Sama Podcast](https://www.sama.com/podcast/moxie-the-robot-teaches-children-kindness-conversational-ai-child-development)
- [Embodied, Inc Launches Moxie — Unite.AI](https://www.unite.ai/embodied-inc-launches-moxie-a-robot-promoting-cognitive-learning-in-children/)

### Voice agent architecture
- [Sequential Pipeline Architecture for Voice Agents — LiveKit](https://livekit.com/blog/sequential-pipeline-architecture-voice-agents)
- [Real-Time (S2S) vs Turn-Based (Cascade) Voice Agent Architecture — Softcery](https://softcery.com/lab/ai-voice-agents-real-time-vs-turn-based-tts-stt-architecture)
- [Voice Agent Infrastructure Stack 2026: Full Reference — Digital Applied](https://www.digitalapplied.com/blog/voice-agent-infrastructure-stack-2026-reference)
- [Voice AI Prompt Engineering: Complete Technical Guide — VoiceInfra](https://voiceinfra.ai/blog/voice-ai-prompt-engineering-complete-guide)
- [Optimizing Voice Agent Barge-in Detection for 2025 — Sparkco](https://sparkco.ai/blog/optimizing-voice-agent-barge-in-detection-for-2025)
- [How to Evaluate Voice Agents in 2025: Beyond ASR and WER — MarkTechPost](https://www.marktechpost.com/2025/10/05/how-to-evaluate-voice-agents-in-2025-beyond-automatic-speech-recognition-asr-and-word-error-rate-wer-to-task-success-barge-in-and-hallucination-under-noise/)
- [Real-Time Barge-In AI for Voice Conversations — Gnani](https://www.gnani.ai/resources/blogs/real-time-barge-in-ai-for-voice-conversations-31347)

### Conversational AI products
- [Pi AI Chatbot: Ultimate Guide to Features & Privacy — Skywork.ai](https://skywork.ai/blog/pi-ai-chatbot-ultimate-guide/)
- [Is Inflection AI's Pi the Most Human AI Assistant? — Sider](https://sider.ai/blog/ai-tools/is-inflection-ai-s-pi-the-most-human-ai-assistant-an-in-depth-review)
- [Inflection AI — Wikipedia](https://en.wikipedia.org/wiki/Inflection_AI)
- [Character.AI: AI Companion Platform — Emergent Mind](https://www.emergentmind.com/topics/character-ai-c-ai)
- [AI Roleplay Custom Persona — Jenova](https://www.jenova.ai/en/resources/ai-roleplay-custom-persona)

### Local source (Codex plugin skill reference)
- `/Users/will/.claude/plugins/cache/openai-codex/codex/1.0.4/skills/gpt-5-4-prompting/SKILL.md`
- `/Users/will/.claude/plugins/cache/openai-codex/codex/1.0.4/skills/gpt-5-4-prompting/references/prompt-blocks.md`
- `/Users/will/.claude/plugins/cache/openai-codex/codex/1.0.4/skills/gpt-5-4-prompting/references/codex-prompt-recipes.md`
- `/Users/will/.claude/plugins/cache/openai-codex/codex/1.0.4/skills/gpt-5-4-prompting/references/codex-prompt-antipatterns.md`
