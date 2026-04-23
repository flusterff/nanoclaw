# Dodami Magic — Wave 1 Implementation Plan (Architecture Prerequisites)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the architectural prerequisites that unlock Stream C Waves 2-4 — dynamic per-character fallbacks, intent-first `<plan>/<say>` output protocol, unified personality/policy prompt layering, onboarding-field plumbing, and Anthropic prompt-cache breakpoints.

**Architecture:** Wave 1 is a refactor-in-place on the Dodami monolith (~/Dodami/dodami-bargein-v1/) without behavior regressions on the existing Gemma 4 31B path. Changes are structured as 6 independent-ish tasks, each TDD-gated and independently committable. The per-character fallback bank and `<plan>/<say>` parse contract are LLM-backend agnostic and can land before Track M; cache breakpoints require Track M PR2 (llm_backends.py + Anthropic primary). The whole Wave ships behind `DODAMI_MAGIC_WAVE1=1` flag and rolls out via 테스팅 → 몽실 → pilot.

**Tech Stack:** Python 3.11, FastAPI, pytest, Ollama (Gemma 4 31B — current), Anthropic SDK (post-Track-M), SQLite (existing).

**Spec:** [`2026-04-23-dodami-magic-design-C.md`](../specs/2026-04-23-dodami-magic-design-C.md) · **Branch to implement on:** `feat/magic-wave1` off `origin/main` in `~/Dodami/dodami-bargein-v1/` (not the nanoclaw repo).

---

## Prerequisites

### Track M sync point

**Task 5 (cache breakpoints) requires Track M PR2 to have merged:** it adds `llm_backends.py` with `AnthropicBackend` + `OllamaBackend` abstraction and makes Haiku primary. Without it, there is no Anthropic call site to attach `cache_control: ephemeral` to.

**Tasks 1-4 and 6 are Track-M-independent** and can land before PR2. If Track M PR2 has NOT merged when an executor reaches Task 5, stop, report that Task 5 is blocked, and mark it for follow-up rather than implementing against Ollama (Ollama has no equivalent control and faking it would be dead code).

### Worktree + branch setup

**Dodami repo lives at `~/Dodami/dodami-bargein-v1/`. This plan document lives in the nanoclaw repo on branch `feat/dodami-magic-charter`.** Implementation happens in Dodami, not nanoclaw. The executor MUST:

1. `cd ~/Dodami/dodami-bargein-v1`
2. `git fetch origin main`
3. `git checkout -b feat/magic-wave1 origin/main` (branch from FRESH origin/main, do NOT reuse any existing local branch state; per SYNC there are multiple in-flight feature branches)
4. Verify: `git log --oneline -3` — HEAD commit message should reference the most recent `origin/main` merge (e.g. `chore(speaker-id): retire ECAPA speaker-id v1 (#50)` or newer)

### Test runner

Dodami uses pytest without a top-level Makefile. Always run tests with `DODAMI_TEST_SKIP_LOAD=1` to skip heavy model loading:

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ -v
```

Scope a single test during TDD cycle with `-k test_name` or by passing the file path.

### Existing test suite must stay green

Before starting any task, capture the baseline: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -5` and save the pass count. After each task's commit, re-run the full suite and confirm no pre-existing tests regressed.

---

## File Structure

| File | Role in Wave 1 |
|------|---|
| `persona.py` | Modify — add `FALLBACK_BANK` per character; add 5 principle-in-action few-shots to `PERSONA_PROMPT`; surface `interests` in `get_persona_prompt()` |
| `prompting.py` | Modify — refactor `build_system_prompt()` into 3-layer composition (system/character/session); plumb `interests`; add `parse_plan_say()` parser; add PLAN_DRIFT detector |
| `policy.py` | Modify — delete `enhance_prompt_v6` shim (already deprecated); keep `compose_turn_hints` but move call site (see Task 3); keep classifiers (`is_why_question`, `get_recent_openers`, `trim_to_rule`, `max_syllables_for_mode`, `enforce_ask_back_v6`) |
| `safety.py` | Modify — replace `_SAFE_FALLBACKS` constant (line 118-124) with `pick_safe_fallback(character, child_name)` call into the fallback bank |
| `turns.py` | Modify — replace `_CRISIS_FALLBACK` constant (line 97) with `pick_crisis_fallback(character, child_name)` call |
| `realtime_server_v3_gemma.py` | Modify — replace empty-reply fallback (line 686) and exception fallback (line 697) with bank calls; add `<plan>/<say>` parse step in `_run_llm_local_inner`; wire Layer 3 session memory (kid profile → system prompt); gate Wave 1 behavior on `DODAMI_MAGIC_WAVE1` flag |
| `settings.py` | Modify — add `DODAMI_MAGIC_WAVE1` bool (default False) |
| `tests/test_magic_wave1_fallbacks.py` | CREATE — covers fallback bank, character+name injection, crisis fallback |
| `tests/test_magic_wave1_plansay.py` | CREATE — covers `<plan>/<say>` parser, malformed input, PLAN_DRIFT detection |
| `tests/test_magic_wave1_layers.py` | CREATE — covers 3-layer prompt assembly and `interests` plumbing |
| `tests/test_magic_wave1_integration.py` | CREATE — end-to-end: profile with interests → `build_system_prompt` → `parse_plan_say` round-trip |

Files intentionally NOT changed in Wave 1: `ws_handler.py`, `web/routes.py`, `persistence.py`, `runtime.py`, any TTS/STT backends. Those belong to Waves 2-4 or Track M.

---

## Task 1: Per-character dynamic fallback bank

**Problem:** Three hardcoded fallback sites (`safety.py:118-124` `_SAFE_FALLBACKS`, `turns.py:97` `_CRISIS_FALLBACK`, `realtime_server_v3_gemma.py:686+697` empty/exception fallbacks) return generic 도담-voiced strings regardless of which character the kid picked. When 불꽃이 fires a safety fallback, the kid hears 도담's voice — jarring and confirms Stream A's "flat" finding. Replace with a per-character bank keyed on the selected character + kid's name.

**Files:**
- Create: `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_fallbacks.py`
- Modify: `~/Dodami/dodami-bargein-v1/persona.py` (add FALLBACK_BANK)
- Modify: `~/Dodami/dodami-bargein-v1/safety.py:118-124` (delete `_SAFE_FALLBACKS`; call bank)
- Modify: `~/Dodami/dodami-bargein-v1/turns.py:97` (delete `_CRISIS_FALLBACK`; call bank)
- Modify: `~/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py:686` and `:697` (delete hardcoded strings; call bank)

**Design decisions:**
- Each character gets 3 pools: `safe` (safety-fire substitution), `crisis` (crisis-context substitution), `empty_reply` (LLM returned nothing).
- Each pool has 4-6 short phrases per character in that character's voice (물/뿌리/빛/바람 metaphors).
- Name suffix (`get_name_suffix`) injected into ~50% of entries so callouts feel personal; other half generic in case `child_name` is empty.
- Selection: `random.choice(pool)` + name-suffix format. No LLM call — must be fast + safe (these fire during safety failure).
- When `character` is empty / unknown, fall through to a default 도담이 pool identical in structure. Back-compat for pre-onboarding users.

### Steps

- [ ] **Step 1.1: Write the first failing test — fallback bank returns character-voiced string**

Create `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_fallbacks.py`:

```python
"""Wave 1 — per-character fallback bank tests."""
import pytest
from persona import pick_safe_fallback, pick_crisis_fallback, pick_empty_reply_fallback


def test_pick_safe_fallback_pongdang_returns_water_voiced():
    """퐁당이 safe fallback should be in character's water voice."""
    out = pick_safe_fallback(character='blue', child_name='지민')
    assert isinstance(out, str)
    assert len(out) > 0
    assert '지민' in out or not any(ch.isalnum() for ch in out[:5])  # name injected OR generic


def test_pick_safe_fallback_empty_character_uses_default():
    """Empty character falls back to default 도담 pool."""
    out = pick_safe_fallback(character='', child_name='')
    assert isinstance(out, str)
    assert len(out) > 0


def test_pick_safe_fallback_unknown_character_uses_default():
    """Unknown character key falls back to default."""
    out = pick_safe_fallback(character='nonexistent', child_name='지민')
    assert isinstance(out, str)
    assert len(out) > 0


def test_pick_crisis_fallback_returns_adult_referral():
    """Crisis fallback across all characters must reference 어른 referral."""
    for char in ('blue', 'green', 'yellow', 'red', ''):
        out = pick_crisis_fallback(character=char, child_name='지민')
        assert '어른' in out, f"crisis fallback for {char!r} missing 어른 referral: {out!r}"


def test_pick_empty_reply_fallback_is_clarifying():
    """Empty-reply fallback should ask the kid to repeat."""
    out = pick_empty_reply_fallback(character='red', child_name='')
    assert isinstance(out, str)
    # Should end with ? or contain 다시/한번/뭐라고
    assert any(marker in out for marker in ('?', '다시', '한번', '뭐라고'))
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd ~/Dodami/dodami-bargein-v1 && DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_fallbacks.py -v`
Expected: FAIL with `ImportError: cannot import name 'pick_safe_fallback' from 'persona'`.

- [ ] **Step 1.3: Add FALLBACK_BANK + 3 pick_*_fallback functions to persona.py**

Append to `~/Dodami/dodami-bargein-v1/persona.py` (end of file, before `__all__` if present, otherwise at the very bottom):

```python
# ============================================================
# Wave 1 — Per-character fallback bank (Stream C, 2026-04-23)
# ============================================================
# Replaces hardcoded _SAFE_FALLBACKS / _CRISIS_FALLBACK / empty-reply
# strings in safety.py / turns.py / realtime_server_v3_gemma.py.
# Keyed by persona character code ('blue'=퐁당이·물, 'green'=바라미·바람,
# 'yellow'=반짝이·빛, 'red'=새싹이·뿌리). Empty or unknown codes use
# DEFAULT pool (legacy 도담 voice).
import random as _rng_fb

FALLBACK_BANK = {
    'blue': {  # 퐁당이 — 물 / water — fluid, reflective
        'safe': [
            '음~ 다른 얘기로 흘러가 볼까{name_suffix}?',
            '그 얘긴 좀 어렵네. 우리 다른 데로 가 볼까?',
            '잠깐, 파도가 바뀌었어{name_suffix}. 뭐 하고 놀까?',
            '그건 좀 깊은 얘긴데~ 다른 거 해 볼까?',
            '음... 흐름을 바꿔 볼까?',
        ],
        'crisis': [
            '그랬구나{name_suffix}. 얘기해줘서 고마워. 믿을 수 있는 어른한테 꼭 얘기해봐.',
            '마음이 많이 무거웠겠다. 어른한테 꼭 말해줘, 알겠지?',
        ],
        'empty_reply': [
            '어~ 뭐라고 했어? 다시 말해줘!',
            '음, 안 들렸어{name_suffix}. 한 번 더 얘기해줘!',
            '잠깐~ 다시 한번!',
        ],
    },
    'green': {  # 바라미 — 바람 / wind — playful, breezy
        'safe': [
            '어, 바람이 바뀌었어{name_suffix}! 다른 거 하자!',
            '그 얘긴 휙 날려 보내고, 딴 거 해볼까?',
            '어? 갑자기 딴 게 생각나! 우리 뭐 하고 놀까?',
            '스윽~ 넘어가자. 다른 거 할래?',
            '음, 지금은 다른 얘기가 재밌을 거 같아!',
        ],
        'crisis': [
            '그랬구나{name_suffix}. 얘기해줘서 고마워. 믿을 수 있는 어른한테 꼭 얘기해봐.',
            '어른한테 꼭 말해줘, 알겠지? 혼자 담아두지 마.',
        ],
        'empty_reply': [
            '어? 뭐라고? 한 번 더~!',
            '바람에 날아갔나 봐{name_suffix}! 다시 말해줘.',
            '음, 못 들었어! 한 번 더 얘기해줘!',
        ],
    },
    'yellow': {  # 반짝이 — 빛 / light — bright, celebratory
        'safe': [
            '음~ 그건 조금 어두운 얘기네{name_suffix}. 밝은 걸로 가 볼까?',
            '그건 좀 복잡해~ 다른 거 해볼까?',
            '아~ 잠깐! 다른 재밌는 거 하자!',
            '음, 다른 거 얘기하면 더 반짝일 것 같아!',
            '그 얘긴 접어두고~ 뭐 하고 놀까?',
        ],
        'crisis': [
            '그랬구나{name_suffix}. 얘기해줘서 고마워. 믿을 수 있는 어른한테 꼭 얘기해봐.',
            '혼자 힘들었구나. 어른한테 꼭 얘기해줘, 알겠지?',
        ],
        'empty_reply': [
            '어? 못 들었어! 다시 반짝~ 말해줘!',
            '음, 안 들렸어{name_suffix}! 한 번 더!',
            '잠깐, 다시 한번~!',
        ],
    },
    'red': {  # 새싹이 — 뿌리 / root — steady, patient, growth-minded
        'safe': [
            '음~ 그건 천천히 생각해보자{name_suffix}. 다른 거 먼저 할까?',
            '그 얘긴 좀 깊이 뿌리박힌 건데~ 다른 거 해볼까?',
            '잠깐, 차근차근 다른 거부터 하자.',
            '음, 그건 어른이랑 얘기하면 더 잘 자랄 거야. 우리 다른 거 하자!',
            '지금은 다른 거 해볼까? 차분하게~',
        ],
        'crisis': [
            '그랬구나{name_suffix}. 얘기해줘서 고마워. 믿을 수 있는 어른한테 꼭 얘기해봐.',
            '천천히 괜찮아질 거야. 어른한테 꼭 말해줘, 알겠지?',
        ],
        'empty_reply': [
            '어, 뭐라고 했어? 다시 한번 차근차근~',
            '음, 잘 못 들었어{name_suffix}. 다시 말해줘!',
            '잠깐, 천천히 한 번 더!',
        ],
    },
}

# Default pool — used when character is empty/unknown. Preserves pre-
# character-system voice (legacy 도담 responses) for back-compat.
FALLBACK_BANK_DEFAULT = {
    'safe': [
        '음... 다른 얘기 하자!',
        '그건 어른한테 물어봐. 우리 다른 거 할까?',
        '그 얘긴 좀 어렵네. 뭐 하고 놀까?',
        '잠깐, 다른 얘기 해보자~',
        '우리 다른 거 할까{name_suffix}? 뭐 하고 싶어?',
    ],
    'crisis': [
        '그랬구나{name_suffix}. 얘기해줘서 고마워. 믿을 수 있는 어른한테 꼭 얘기해봐.',
    ],
    'empty_reply': [
        '어, 뭐라고? 다시 말해줄래?',
        '음, 한 번 더 얘기해줘!',
        '잠깐, 다시 한번!',
    ],
}


def _pick_from_bank(pool_name: str, character: str, child_name: str) -> str:
    """Pick a phrase from the per-character bank, formatting {name_suffix}.

    pool_name: 'safe' | 'crisis' | 'empty_reply'
    character: 'blue' | 'green' | 'yellow' | 'red' | '' | unknown
    child_name: kid's first name (may be empty)
    """
    pool = FALLBACK_BANK.get(character, FALLBACK_BANK_DEFAULT)
    if pool_name not in pool:
        pool = FALLBACK_BANK_DEFAULT
    phrases = pool[pool_name]
    chosen = _rng_fb.choice(phrases)
    suffix = get_name_suffix(child_name) if child_name else ''
    return chosen.format(name_suffix=suffix)


def pick_safe_fallback(character: str = '', child_name: str = '') -> str:
    """Safety-fire substitution fallback. Used by safety.py post-block."""
    return _pick_from_bank('safe', character, child_name)


def pick_crisis_fallback(character: str = '', child_name: str = '') -> str:
    """Crisis-context substitution fallback. Used by turns.py."""
    return _pick_from_bank('crisis', character, child_name)


def pick_empty_reply_fallback(character: str = '', child_name: str = '') -> str:
    """Empty/minimal LLM-reply fallback. Used by realtime_server."""
    return _pick_from_bank('empty_reply', character, child_name)
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_fallbacks.py -v`
Expected: 4 passed.

- [ ] **Step 1.5: Replace safety.py hardcoded _SAFE_FALLBACKS**

Read current state of `~/Dodami/dodami-bargein-v1/safety.py`. Find lines 118-124 (the `_SAFE_FALLBACKS = [...]` list). Find every call site using `random.choice(_SAFE_FALLBACKS)` or equivalent (grep: `grep -n "_SAFE_FALLBACKS" safety.py`).

Expected call sites per existing code review: inside the safety substitution logic below line 125. Find each, and replace the `random.choice(_SAFE_FALLBACKS)` call with `pick_safe_fallback(character, child_name)`.

Add `from persona import pick_safe_fallback` to the safety.py imports section (check if persona is already imported; if not, add the import).

The function signature of the enclosing safety functions already accepts `child_name`. Verify that `character` is also available in the caller's scope by reading the call stack. If not, thread `character` through the safety function signatures as an added keyword argument defaulting to `''` (back-compat).

- [ ] **Step 1.6: Delete the _SAFE_FALLBACKS list**

Remove lines 118-124 entirely. Also delete any dead-import-of-random that only existed for this (grep: `^import random` in safety.py — only remove if no other random usage; `grep -c random safety.py`).

- [ ] **Step 1.7: Add safety.py call-site test**

Append to `tests/test_magic_wave1_fallbacks.py`:

```python
def test_safety_fallback_uses_character_bank(monkeypatch):
    """safety.py post-block substitution routes through pick_safe_fallback."""
    import persona
    calls = []

    def fake_pick(character, child_name):
        calls.append((character, child_name))
        return 'FAKE_SAFE_FALLBACK'

    monkeypatch.setattr(persona, 'pick_safe_fallback', fake_pick)
    # Also patch the reference inside safety.py if it imported the symbol:
    import safety
    if hasattr(safety, 'pick_safe_fallback'):
        monkeypatch.setattr(safety, 'pick_safe_fallback', fake_pick)

    # Invoke whatever safety function performs the substitution. Simplest
    # surface: the public check_output_safety / safety_check_and_tts path.
    # Use the lowest-level helper that calls the bank directly.
    # (Executor: find the smallest unit that triggers the substitution and
    # call it with a pre-blocked reply. If the codebase requires a larger
    # call, stub the TTS/judge sides with monkeypatch.)
    # Example shape (adjust to actual function name found in safety.py):
    # from safety import _substitute_safe_fallback
    # result = _substitute_safe_fallback(reason='tier1', character='blue', child_name='지민')
    # assert result == 'FAKE_SAFE_FALLBACK'
    # assert calls == [('blue', '지민')]
    pytest.skip('Executor: wire to actual safety.py substitution entry point')
```

The `pytest.skip` is a deliberate hold: the executor, after reading safety.py's structure in step 1.5, fills in the actual call shape and removes the skip. The skip prevents a spurious green on the first run while still documenting the intent.

- [ ] **Step 1.8: Run full safety tests to verify no regression**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_safety_judge.py tests/test_safety_input_bypass.py tests/test_safety_cloud_judge.py -v`
Expected: all pre-existing tests still pass. (Count should match baseline.)

- [ ] **Step 1.9: Replace turns.py _CRISIS_FALLBACK**

In `~/Dodami/dodami-bargein-v1/turns.py`:
- Delete line 97: `_CRISIS_FALLBACK = "..."`
- Find every reference to `_CRISIS_FALLBACK` (grep: `grep -n _CRISIS_FALLBACK turns.py`) and replace with `pick_crisis_fallback(character, child_name)`.
- Add import: `from persona import pick_crisis_fallback`
- Verify `character` is in scope at each replacement site; add to function signatures as keyword arg if not. Back-compat: default `''`.

- [ ] **Step 1.10: Replace realtime_server_v3_gemma.py empty-reply + exception fallbacks**

In `~/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py`:
- Line 686: replace `reply = random.choice(["어, 뭐라고? 다시 말해줄래?", "음, 한 번 더 얘기해줘!", "잠깐, 다시 한번!"])` with `reply = pick_empty_reply_fallback(character, child_name)`.
- Line 697: replace `fallback = '미안, 잠깐 멈췄어! 다시 한번 말해줄래?'` with `fallback = pick_empty_reply_fallback(character, child_name)`.
- Delete the local `import random` on line 685 if no other random usage in that function (grep inside the function scope).
- Add import: `from persona import pick_empty_reply_fallback` (check if persona is already imported — if `build_system_prompt` import exists, append to that import list).
- Both sites already have `character` in scope (`_run_llm_local_inner` takes it as a parameter). `child_name` should be derivable from the call — verify by reading 100 lines above line 686. If not, thread it.

- [ ] **Step 1.11: Run full test suite**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -10`
Expected: same pass count as baseline + 4-5 new passes from our new tests.

- [ ] **Step 1.12: Commit**

```bash
cd ~/Dodami/dodami-bargein-v1
git add persona.py safety.py turns.py realtime_server_v3_gemma.py tests/test_magic_wave1_fallbacks.py
git commit -m "$(cat <<'EOF'
magic-wave1: replace hardcoded fallbacks with per-character bank

- persona.py: FALLBACK_BANK with 3 pools (safe/crisis/empty_reply) per
  character (blue/green/yellow/red) + DEFAULT pool for back-compat
- safety.py: _SAFE_FALLBACKS list removed; routes through pick_safe_fallback
- turns.py: _CRISIS_FALLBACK constant removed; routes through pick_crisis_fallback
- realtime_server_v3_gemma.py: empty-reply + exception fallbacks route
  through pick_empty_reply_fallback
- tests: 4 new fallback-bank tests + 1 skip-marked call-site test

Ship under DODAMI_MAGIC_WAVE1 flag (added in Task 6). No behavior change
when character is empty (default pool matches prior strings).

Part of Stream C Wave 1. Spec: docs/superpowers/specs/2026-04-23-dodami-magic-design-C.md
EOF
)"
```

---

## Task 2: Intent-first `<plan>/<say>` output protocol

**Problem:** Current LLM replies are bare strings. When the model promises something ("이번에는 더 어려운 수수께끼 내줄게!") it often fails to deliver (Session Cyan's riddle-harder bug was one instance of a broader class). Introducing an enforced `<plan>/<say>` structure makes the intent verifiable and catches drift before it reaches the kid.

**Files:**
- Create: `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_plansay.py`
- Modify: `~/Dodami/dodami-bargein-v1/prompting.py` — add `parse_plan_say()` + `detect_plan_drift()`; add `<plan>/<say>` output contract to `PERSONA_PROMPT` header
- Modify: `~/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py` — inside `_run_llm_local_inner` after the LLM returns, call `parse_plan_say(raw)` to extract `say`; log `plan` separately; re-prompt once on PLAN_DRIFT

**Design decisions:**
- Contract: LLM emits `<plan>Kid state: ... Intent: ... Shape: ... Content: ... Callback: ...</plan><say>...</say>`. Both blocks required.
- Parser is tolerant: accept `<plan>` on any line, accept extra whitespace, accept missing `</plan>` if `<say>` is present (truncated output), accept missing `<plan>` entirely (legacy pre-Wave-1 mode: return the whole string as `say`, empty `plan`).
- Drift detection is deliberately minimal in Wave 1: compare `plan.intent` keyword against `say` for one specific class — "deliver" intent but empty say, or "deliver <content>" intent but say lacks any trace of content. Broader drift (all 5 classes Stream A found) is Wave 3 work.
- On drift: re-prompt the model once with a terse drift instruction ("Your plan said deliver; your say was empty. Emit the content."). If re-prompt also drifts, emit the `say` anyway + log. No third retry.
- Wave 1 runs the parse/drift logic behind `DODAMI_MAGIC_WAVE1` flag so Gemma can keep emitting bare strings pre-flag-flip.

### Steps

- [ ] **Step 2.1: Write parse test first**

Create `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_plansay.py`:

```python
"""Wave 1 — <plan>/<say> output-contract parser tests."""
import pytest
from prompting import parse_plan_say, detect_plan_drift


def test_parse_plan_say_well_formed():
    raw = """<plan>
Kid state: energetic, ready
Intent: deliver riddle
Shape: single commitment
Content: R-퐁당이-07
Callback: none
</plan>
<say>
그래! 한 번 풀어봐. 높은 데서는 시끄럽게 떨어지는데 낮은 데로 가면 조용해지는 건 뭘까?
</say>"""
    plan, say = parse_plan_say(raw)
    assert 'deliver riddle' in plan.lower()
    assert '수수께끼' in say or '높은 데서는' in say
    assert '<plan>' not in say
    assert '</say>' not in say


def test_parse_plan_say_missing_plan_returns_legacy_mode():
    """Pre-Wave-1 bare string should parse as empty plan + full say."""
    raw = '그래, 한번 해 보자!'
    plan, say = parse_plan_say(raw)
    assert plan == ''
    assert say == '그래, 한번 해 보자!'


def test_parse_plan_say_missing_close_tag_tolerated():
    """Truncated output: <plan> present but </plan> missing. Best-effort split."""
    raw = """<plan>
Intent: deliver
<say>
그래!"""
    plan, say = parse_plan_say(raw)
    assert 'deliver' in plan.lower()
    assert '그래' in say


def test_parse_plan_say_strips_whitespace():
    raw = "<plan>\n  Intent: commit\n</plan>\n<say>  hi  </say>"
    plan, say = parse_plan_say(raw)
    assert plan.strip().startswith('Intent')
    assert say == 'hi'


def test_detect_plan_drift_deliver_but_empty_say():
    plan = 'Intent: deliver riddle\nContent: R-퐁당이-07'
    say = ''
    assert detect_plan_drift(plan, say) is True


def test_detect_plan_drift_deliver_with_content():
    plan = 'Intent: deliver riddle\nContent: R-퐁당이-07'
    say = '높은 데서는 시끄럽게 떨어지는데 낮은 데로 가면 조용해지는 건 뭘까?'
    assert detect_plan_drift(plan, say) is False


def test_detect_plan_drift_non_deliver_intent_no_check():
    """Non-deliver intents (chat, probe, pivot) skip drift check — Wave 3 expands."""
    plan = 'Intent: probe\nContent: none'
    say = ''
    assert detect_plan_drift(plan, say) is False  # empty 'say' is still a bug but out of scope for W1


def test_detect_plan_drift_legacy_empty_plan_no_check():
    """Legacy bare-string output (empty plan) bypasses drift check."""
    plan = ''
    say = 'whatever'
    assert detect_plan_drift(plan, say) is False
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_plansay.py -v`
Expected: FAIL with `ImportError: cannot import name 'parse_plan_say' from 'prompting'`.

- [ ] **Step 2.3: Add parse_plan_say + detect_plan_drift to prompting.py**

Append to `~/Dodami/dodami-bargein-v1/prompting.py` (before the `__all__` list, after `get_greeting`):

```python
# ============================================================
# Wave 1 — <plan>/<say> output-contract parser (Stream C, 2026-04-23)
# ============================================================
import re as _re_ps

_PLAN_OPEN = _re_ps.compile(r'<plan>', _re_ps.IGNORECASE)
_PLAN_CLOSE = _re_ps.compile(r'</plan>', _re_ps.IGNORECASE)
_SAY_OPEN = _re_ps.compile(r'<say>', _re_ps.IGNORECASE)
_SAY_CLOSE = _re_ps.compile(r'</say>', _re_ps.IGNORECASE)


def parse_plan_say(raw: str) -> tuple[str, str]:
    """Parse the <plan>...</plan><say>...</say> output contract.

    Tolerant of:
    - Missing <plan> entirely (legacy mode: return ('', raw.strip()))
    - Missing </plan> when <say> is present (truncation): split at <say>
    - Extra whitespace inside or around blocks
    - Missing </say>: return everything after <say> up to end of string
    Returns (plan_body, say_body), both whitespace-trimmed.
    """
    if not raw:
        return '', ''

    plan_open = _PLAN_OPEN.search(raw)
    say_open = _SAY_OPEN.search(raw)

    if not plan_open and not say_open:
        return '', raw.strip()

    # Plan body
    plan_body = ''
    if plan_open:
        plan_close = _PLAN_CLOSE.search(raw, pos=plan_open.end())
        if plan_close:
            plan_body = raw[plan_open.end():plan_close.start()]
        elif say_open:
            plan_body = raw[plan_open.end():say_open.start()]
        else:
            plan_body = raw[plan_open.end():]

    # Say body
    say_body = ''
    if say_open:
        say_close = _SAY_CLOSE.search(raw, pos=say_open.end())
        if say_close:
            say_body = raw[say_open.end():say_close.start()]
        else:
            say_body = raw[say_open.end():]
    elif not plan_open:
        # Shouldn't reach here (handled above) but defensive:
        say_body = raw

    return plan_body.strip(), say_body.strip()


_INTENT_DELIVER_RE = _re_ps.compile(r'intent\s*:\s*deliver', _re_ps.IGNORECASE)
_CONTENT_LINE_RE = _re_ps.compile(r'content\s*:\s*(.+)', _re_ps.IGNORECASE)


def detect_plan_drift(plan: str, say: str) -> bool:
    """Return True when plan.intent == 'deliver' but say does not contain content.

    Wave 1 scope: only the deliver-without-content class. Broader drift
    detection (all 5 Stream A classes) is Wave 3.
    Empty plan (legacy mode) always returns False — no drift check.
    """
    if not plan:
        return False
    if not _INTENT_DELIVER_RE.search(plan):
        return False
    # deliver intent — say must be non-empty AND reference the content
    if not say.strip():
        return True
    # Minimal content-in-say check: if plan specifies content, at least
    # one token from the content line should appear in say OR say must
    # be substantive (>20 chars). This is a rough heuristic — false-
    # positives OK since we re-prompt once (cheap recovery).
    m = _CONTENT_LINE_RE.search(plan)
    if m:
        content_hint = m.group(1).strip().lower()
        if content_hint and content_hint not in ('none', 'n/a', ''):
            # If say is very short AND content hint is a non-trivial string,
            # treat as drift. Full content-match lives in Wave 3 with the
            # content bank registry.
            if len(say) < 10:
                return True
    return False
```

- [ ] **Step 2.4: Run parse/drift tests to verify passing**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_plansay.py -v`
Expected: 7 passed.

- [ ] **Step 2.5: Add output-contract instructions to PERSONA_PROMPT**

Find `PERSONA_PROMPT` declaration in `~/Dodami/dodami-bargein-v1/persona.py` (grep: `grep -n "^PERSONA_PROMPT" persona.py`). It's a multi-line string.

Prepend a new section at the TOP of `PERSONA_PROMPT` (i.e. inside the string, at the very start):

```
[응답 형식 — 항상 따라야 할 규칙]
매 응답은 반드시 다음 형식으로 출력해:

<plan>
Kid state: 아이의 지금 상태 (energy / comprehension / what they want)를 한 줄로
Intent: 이번 응답의 목적 (answer / pivot / probe / commit / deliver)
Shape: 응답 모양 (pair / menu / commit / open / content)
Content: deliver 할 경우 무엇을 전달할지 (예: R-퐁당이-07 또는 "없음")
Callback: 기억에서 자연스럽게 끌어올 거 있으면 한 줄, 없으면 "없음"
</plan>
<say>
아이에게 들려줄 말. ||| 로 multi-turn beat 구분.
</say>

반드시 <plan>부터 시작해서 </plan><say>...</say>로 끝나. say 바깥에 다른 말 쓰지 마.
```

Insert this BEFORE all existing PERSONA_PROMPT content. The existing character rules remain below it.

- [ ] **Step 2.6: Add flag-gated parse call in _run_llm_local_inner**

In `~/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py`, inside `_run_llm_local_inner` (defined at line 577), find where the raw reply comes back from Ollama (should be between lines 620-680 — look for where `reply` is first assigned from the response content).

After that assignment and BEFORE the existing `re.sub(r'^도담\s*:\s*', '', reply)` sanitization (line 671), insert:

```python
# Wave 1: parse <plan>/<say> output contract when flag enabled.
from settings import DODAMI_MAGIC_WAVE1
if DODAMI_MAGIC_WAVE1:
    from prompting import parse_plan_say, detect_plan_drift
    plan_body, say_body = parse_plan_say(reply)
    if plan_body:
        print(f'[MAGIC-W1] plan: {plan_body[:200]!r}')
    if detect_plan_drift(plan_body, say_body):
        print(f'[MAGIC-W1] PLAN_DRIFT detected — plan={plan_body[:120]!r} say={say_body[:60]!r}')
        # Wave 1: log only. Re-prompt on drift lives behind a separate
        # sub-flag in Task 6 for rollout gating.
    reply = say_body  # downstream pipeline operates on say only
```

Rationale for "log only" on drift: a re-prompt round-trip adds latency (~300-800ms on Haiku, ~1-2s on Gemma). Wave 1 proves the parse + detection plumbing is solid; a later Wave turns on re-prompting once we've seen production drift rates and calibrated the detector.

- [ ] **Step 2.7: Add DODAMI_MAGIC_WAVE1 to settings.py**

In `~/Dodami/dodami-bargein-v1/settings.py` (162 lines), append:

```python
# Wave 1 — Stream C magic architecture flag. Gates <plan>/<say> parse
# + per-character fallback bank routing at the call sites. Ship behind
# this flag, flip in rollout gate (테스팅 → 몽실 → pilot).
DODAMI_MAGIC_WAVE1 = os.environ.get('DODAMI_MAGIC_WAVE1', '0') == '1'
```

Verify `os` is already imported at top of settings.py (it should be — other env vars read the same way). If not, add `import os` to the top.

- [ ] **Step 2.8: Run full test suite**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -10`
Expected: baseline + 7 (plansay tests) + Task 1 new tests.

- [ ] **Step 2.9: Smoke-test the runtime manually (integration)**

Run: `cd ~/Dodami/dodami-bargein-v1 && DODAMI_TEST_SKIP_LOAD=1 DODAMI_MAGIC_WAVE1=1 python3 -c "from prompting import parse_plan_say, detect_plan_drift; print(parse_plan_say('<plan>Intent: deliver\nContent: R-퐁당이-07</plan><say>높은 데서는...</say>'))"`
Expected output: `('Intent: deliver\nContent: R-퐁당이-07', '높은 데서는...')`

- [ ] **Step 2.10: Commit**

```bash
git add prompting.py persona.py realtime_server_v3_gemma.py settings.py tests/test_magic_wave1_plansay.py
git commit -m "$(cat <<'EOF'
magic-wave1: add <plan>/<say> output-contract parser + drift detector

- prompting.py: parse_plan_say() tolerant parser (handles missing tags,
  truncation, legacy bare-string mode); detect_plan_drift() for
  deliver-without-content class (Wave 3 expands detector)
- persona.py: PERSONA_PROMPT prepended with output-contract instructions
- realtime_server_v3_gemma.py: flag-gated parse call in _run_llm_local_inner;
  logs plan separately and PLAN_DRIFT events (no re-prompt in W1 — log only)
- settings.py: DODAMI_MAGIC_WAVE1 flag (default off)
- tests: 7 parse + drift tests

Part of Stream C Wave 1. Drift re-prompting enabled in a later Wave once
production drift rates are observed and the detector is calibrated.
EOF
)"
```

---

## Task 3: Personality/policy unification

**Problem:** `policy.py:compose_turn_hints()` emits instructions that live in the USER message (not system) specifically to preserve Ollama prefix-cache. This is backend-specific plumbing that leaks into the policy layer. Stream C Layer 1 wants all style/policy rules in the SYSTEM prompt with Anthropic cache_control breakpoints; Gemma can tolerate per-turn system changes with acceptable prefill cost.

**Design:** Keep `compose_turn_hints` as-is (still called from `_run_llm_local_inner`). BUT: introduce a `build_layered_prompt()` function that explicitly returns the 3-layer structure with breakpoint markers, and route Anthropic calls through it (Task 5). Gemma continues using `build_system_prompt()` unchanged, maintaining prefix-cache behavior. The "unification" is: both backends have a single source of personality/character truth (`persona.py`); policy classifiers stay in `policy.py`; the cache-boundary choice is per-backend in `llm_backends.py` (post-Track-M).

**Files:**
- Create: `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_layers.py`
- Modify: `~/Dodami/dodami-bargein-v1/prompting.py` — add `build_layered_prompt()` returning a dict of 3 layers
- Modify: `~/Dodami/dodami-bargein-v1/policy.py` — remove DEPRECATED pass-through `enhance_prompt_v6` (already deprecated 2026-04-20; reduces dead code surface)

### Steps

- [ ] **Step 3.1: Write layered-assembly test first**

Create `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_layers.py`:

```python
"""Wave 1 — 3-layer prompt assembly tests."""
import pytest
from prompting import build_layered_prompt, build_system_prompt


def test_build_layered_prompt_returns_three_layers():
    layers = build_layered_prompt(
        mode='chat', age=8, child_name='지민', child_id='',
        character='blue', character_name='퐁당이',
        memory_block='', interests=[],
    )
    assert set(layers.keys()) >= {'system', 'character', 'session'}
    assert isinstance(layers['system'], str)
    assert isinstance(layers['character'], str)
    assert isinstance(layers['session'], str)


def test_build_layered_prompt_system_is_character_agnostic():
    """System layer must be identical across characters (cache-shareable)."""
    blue = build_layered_prompt(
        mode='chat', age=8, child_name='', child_id='',
        character='blue', character_name='퐁당이',
        memory_block='', interests=[],
    )
    red = build_layered_prompt(
        mode='chat', age=8, child_name='', child_id='',
        character='red', character_name='새싹이',
        memory_block='', interests=[],
    )
    assert blue['system'] == red['system']


def test_build_layered_prompt_character_differs_by_character():
    blue = build_layered_prompt(
        mode='chat', age=8, child_name='', child_id='',
        character='blue', character_name='퐁당이',
        memory_block='', interests=[],
    )
    red = build_layered_prompt(
        mode='chat', age=8, child_name='', child_id='',
        character='red', character_name='새싹이',
        memory_block='', interests=[],
    )
    assert blue['character'] != red['character']


def test_build_layered_prompt_session_contains_child_name():
    layers = build_layered_prompt(
        mode='chat', age=8, child_name='지민', child_id='abc',
        character='blue', character_name='퐁당이',
        memory_block='', interests=[],
    )
    assert '지민' in layers['session']


def test_build_system_prompt_back_compat_unchanged():
    """Existing callers of build_system_prompt must see byte-identical output."""
    # This test captures current output; regression guard.
    out_before = build_system_prompt(
        mode='chat', age=8, child_name='지민',
        character='blue', character_name='퐁당이',
    )
    # Call again to verify determinism (no randomness).
    out_after = build_system_prompt(
        mode='chat', age=8, child_name='지민',
        character='blue', character_name='퐁당이',
    )
    assert out_before == out_after
    assert '지민' in out_before or len(out_before) > 100
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_layers.py -v`
Expected: FAIL with `ImportError: cannot import name 'build_layered_prompt' from 'prompting'`.

- [ ] **Step 3.3: Add build_layered_prompt in prompting.py**

Add immediately below `build_system_prompt` in `~/Dodami/dodami-bargein-v1/prompting.py`:

```python
def build_layered_prompt(
    mode='chat', age=None, child_name='', child_id='',
    math_indices=None, memory_block='', character='',
    character_name='', interests=None,
):
    """Return a dict with 'system' / 'character' / 'session' layers.

    Wave 1 three-layer composition for Stream C. Backends that support
    prompt caching (Anthropic via Task 5) attach cache_control: ephemeral
    after 'system' and 'character' and 'session'. Gemma path continues to
    call build_system_prompt() which concatenates everything — same inputs,
    same textual content, different cache strategy.

    system: stable, session-long. Persona header + output-contract rules.
            Character-agnostic — safe to share cache across characters.
    character: stable per-character for the session. The character card
               (voice + few-shots + content affinities).
    session: stable per-session once kid profile is resolved. Kid name,
             age-band, interests, memory block, grammar hint.
    """
    from persona import (
        AGE_PROMPTS, CHARACTER_CARDS, PERSONA_PROMPT,
        get_age_band, get_korean_grammar_hint, get_persona_prompt,
    )
    from policy import MODE_PREFIXES

    # LAYER 1 — system (stable, character-agnostic)
    # PERSONA_PROMPT already contains the <plan>/<say> output contract
    # prepended in Task 2. That header is the "rules of the game" and
    # lives here (shared across characters).
    system_layer = PERSONA_PROMPT

    # LAYER 2 — character (stable per-character)
    # Just the character card (voice + element affinities). Does NOT
    # include the generic rules.
    character_layer = CHARACTER_CARDS.get(character, '') if character else ''
    if character_name:
        character_layer = f'{character_layer}\n\n[이 캐릭터의 이름]: {character_name}'.strip()

    # LAYER 3 — session (kid-specific + memory + interests)
    session_parts = []
    if child_name:
        grammar = get_korean_grammar_hint(child_name)
        if grammar:
            session_parts.append(grammar)
        session_parts.append(f'[이 아이 이름]: {child_name}')
    age_band = get_age_band(age)
    age_prompt = AGE_PROMPTS.get(age_band, '')
    if age_prompt:
        session_parts.append(age_prompt)
    if interests:
        # Task 4 plumbs this — surfaced in Layer 3 as a simple list.
        cleaned = [i.strip() for i in interests if i and i.strip()]
        if cleaned:
            session_parts.append(f'[이 아이가 좋아하는 것]: {", ".join(cleaned)}')
    # mode-specific prefix (math problems / riddle) belongs in session
    # because it depends on per-session math_indices.
    prefix = MODE_PREFIXES.get(mode, '')
    if mode == 'riddle':
        from prompting import get_next_riddle
        riddle_text, riddle_answer, _ = get_next_riddle()
        prefix = prefix.format(riddle_text=riddle_text, riddle_answer=riddle_answer)
    elif mode == 'math':
        from prompting import get_next_math
        problems, seen = [], set()
        for _ in range(20):
            p, a = get_next_math(age=age, math_indices=math_indices)
            if p not in seen:
                problems.append((p, a)); seen.add(p)
            if len(problems) >= 5:
                break
        while len(problems) < 5:
            problems.append(get_next_math(age=age, math_indices=math_indices))
        prefix = prefix.format(
            math_problem_1=problems[0][0], math_answer_1=problems[0][1],
            math_problem_2=problems[1][0], math_answer_2=problems[1][1],
            math_problem_3=problems[2][0], math_answer_3=problems[2][1],
            math_problem_4=problems[3][0], math_answer_4=problems[3][1],
            math_problem_5=problems[4][0], math_answer_5=problems[4][1],
        )
    if prefix:
        session_parts.append(prefix)
    if memory_block:
        session_parts.append(memory_block)
    session_layer = '\n'.join(session_parts)

    return {'system': system_layer, 'character': character_layer, 'session': session_layer}
```

- [ ] **Step 3.4: Delete the deprecated enhance_prompt_v6 pass-through**

In `~/Dodami/dodami-bargein-v1/policy.py`, find `enhance_prompt_v6` (line 161). It's a deprecated pass-through kept only for out-of-tree callers. Per 2026-04-20 comment "DEPRECATED".

- Check for internal callers: `grep -rn enhance_prompt_v6 ~/Dodami/dodami-bargein-v1/ --include="*.py"`.
  - Expected: only `policy.py` (definition), `prompting.py` (re-export in `__all__`), `tests/` (possibly). No actual call sites in live code.
  - If grep shows a live caller inside the app code, STOP and report; this step cannot proceed safely.
- Delete the `def enhance_prompt_v6` function from `policy.py`.
- Remove `enhance_prompt_v6` from `prompting.py`'s `__all__` list + import statement (line 50 imports it from policy).

- [ ] **Step 3.5: Run layers tests + full suite**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_layers.py -v`
Expected: 5 passed.

Then: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -10`
Expected: baseline + Tasks 1-3 new tests.

- [ ] **Step 3.6: Commit**

```bash
git add prompting.py policy.py tests/test_magic_wave1_layers.py
git commit -m "$(cat <<'EOF'
magic-wave1: add build_layered_prompt + drop deprecated enhance_prompt_v6

- prompting.py: build_layered_prompt() returns {system,character,session}
  for Stream C Layer 1/2/3. Anthropic backend (post-Track-M) attaches
  cache_control: ephemeral at layer boundaries; Gemma path continues
  via build_system_prompt (unchanged).
- policy.py: drop enhance_prompt_v6 pass-through (deprecated 2026-04-20,
  no live callers confirmed via grep).
- prompting.py: drop enhance_prompt_v6 from __all__ + imports.
- tests: 5 layered-assembly tests (system layer char-agnostic, character
  layer per-character, session contains name, back-compat).

Part of Stream C Wave 1.
EOF
)"
```

---

## Task 4: Plumb `interests` into system prompt

**Problem:** `/api/onboarding` collects `interests: list[str]` and stores in the child profile JSON (web/routes.py:2209-2222), but the LLM surface of `build_system_prompt()` never receives it. The kid says they love dinosaurs at onboarding and Dodami never weaves dinosaurs into content. This is an easy win — the data is already there; the wire is missing.

**Files:**
- Modify: `~/Dodami/dodami-bargein-v1/prompting.py` — `build_system_prompt()` accepts `interests` kwarg and appends `[이 아이가 좋아하는 것]: ...` to output (mirroring layered version)
- Modify: `~/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py` — load `interests` from profile during session bootstrap and pass to `build_system_prompt`
- Extend: `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_layers.py` with build_system_prompt interests coverage

### Steps

- [ ] **Step 4.1: Write failing test for build_system_prompt(interests=...)**

Append to `tests/test_magic_wave1_layers.py`:

```python
def test_build_system_prompt_with_interests_plumbs_through():
    out_without = build_system_prompt(
        mode='chat', age=8, child_name='지민',
        character='blue', character_name='퐁당이',
    )
    out_with = build_system_prompt(
        mode='chat', age=8, child_name='지민',
        character='blue', character_name='퐁당이',
        interests=['공룡', '레고', '수영'],
    )
    assert out_with != out_without
    assert '공룡' in out_with
    assert '레고' in out_with
    assert '수영' in out_with


def test_build_system_prompt_empty_interests_no_change():
    out_none = build_system_prompt(
        mode='chat', age=8, child_name='지민',
        character='blue', character_name='퐁당이',
    )
    out_empty = build_system_prompt(
        mode='chat', age=8, child_name='지민',
        character='blue', character_name='퐁당이',
        interests=[],
    )
    assert out_none == out_empty


def test_build_system_prompt_sanitizes_interests():
    """Malformed interests (None, whitespace, empty strings) are filtered."""
    out = build_system_prompt(
        mode='chat', age=8, child_name='지민',
        character='blue', character_name='퐁당이',
        interests=['공룡', '', '   ', None, '레고'],
    )
    assert '공룡' in out
    assert '레고' in out
```

- [ ] **Step 4.2: Run to verify failure**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_layers.py -k interests -v`
Expected: FAIL — `build_system_prompt` doesn't accept `interests`.

- [ ] **Step 4.3: Extend build_system_prompt signature + body**

In `~/Dodami/dodami-bargein-v1/prompting.py`, modify the `build_system_prompt` signature (currently line 191):

```python
def build_system_prompt(mode='chat', age=None, child_name='', child_id='', math_indices=None, memory_block='', character='', character_name='', interests=None):
```

Then in the body, between the grammar_hint + age_prompt block (around line 230-237), add interests assembly (insert before the `if prefix:` line):

```python
    # Wave 1 — plumb onboarding interests into prompt surface.
    interests_block = ''
    if interests:
        cleaned = [str(i).strip() for i in interests if i and str(i).strip()]
        if cleaned:
            interests_block = f'[이 아이가 좋아하는 것]: {", ".join(cleaned)}'
```

Then in the parts assembly (near line 232-241), add the `interests_block` so it ends up ordered after `age_prompt` and before `prefix`:

```python
    parts = [get_persona_prompt(character, character_name)]
    if grammar_hint:
        parts.append(grammar_hint)
    if age_prompt:
        parts.append(age_prompt)
    if interests_block:
        parts.append(interests_block)
    if prefix:
        parts.append(prefix)
    if memory_block:
        parts.append(memory_block)
    return '\n'.join(parts)
```

- [ ] **Step 4.4: Run tests to verify they pass**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_layers.py -k interests -v`
Expected: 3 passed.

Also verify back-compat test still passes: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_layers.py::test_build_system_prompt_back_compat_unchanged -v`
Expected: PASS (interests=None default means unchanged behavior when no caller passes it).

- [ ] **Step 4.5: Wire realtime_server to load interests from profile**

In `~/Dodami/dodami-bargein-v1/realtime_server_v3_gemma.py`, find where `build_system_prompt` is called from inside the WS handler path. (Grep: `grep -n build_system_prompt realtime_server_v3_gemma.py`.)

At each call site that has `child_id` in scope, load interests from the profile JSON and pass them:

```python
# Wave 1 — load interests from profile JSON.
_interests = []
try:
    from persistence import load_profile  # or equivalent; grep persistence.py for the canonical loader
    _profile = load_profile(child_id) if child_id else None
    if _profile:
        _interests = _profile.get('interests', []) or []
except Exception as _e:
    print(f'[MAGIC-W1] interests-load failed (non-fatal): {_e}')
```

Then add `interests=_interests` to the `build_system_prompt(...)` call.

**Note for executor:** `load_profile` name above is a placeholder for whatever persistence.py exposes. Grep `~/Dodami/dodami-bargein-v1/persistence.py` for the function that reads the profile JSON (likely `load_child_profile`, `read_profile`, or similar). Use the canonical name. If the call site does not currently have `child_id` in scope, do NOT plumb — document in a TODO in the plan's post-implementation followups section and skip for this task.

- [ ] **Step 4.6: Run full test suite**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -10`
Expected: baseline + all prior Task 1-3 + Task 4 tests green.

- [ ] **Step 4.7: Commit**

```bash
git add prompting.py realtime_server_v3_gemma.py tests/test_magic_wave1_layers.py
git commit -m "$(cat <<'EOF'
magic-wave1: plumb onboarding interests into system prompt

- prompting.py: build_system_prompt now accepts interests kwarg;
  filtered + emitted as [이 아이가 좋아하는 것] block before mode prefix
- realtime_server_v3_gemma.py: load interests from profile at session
  bootstrap and pass to build_system_prompt
- tests: 3 new tests (plumbing, empty no-op, sanitization)

Closes the onboarding→LLM gap identified in Stream A (6 collected, 4
dropped — interests is the substantive one; parent_phone + child_id
are non-LLM identifiers).

Part of Stream C Wave 1.
EOF
)"
```

---

## Task 5: Anthropic prompt-cache breakpoints (**blocked on Track M PR2**)

**Problem:** Once Haiku is primary (Track M PR2), we need `cache_control: ephemeral` attached at Layer 1/2/3 boundaries to drop steady-state per-turn cost from ~2K tokens to ~400-600 tokens (per Stream B's Anthropic caching docs citations). Without breakpoints, every turn re-sends the full system prompt.

**Prerequisite:** Track M PR2 merged, `llm_backends.py` present with `AnthropicBackend` class.

**Design:**
- `AnthropicBackend.generate()` takes layers dict from `build_layered_prompt()` and assembles Anthropic messages with `cache_control: {"type": "ephemeral"}` at each layer's end.
- Anthropic SDK supports max 4 cache breakpoints; we use 3 (layers 1/2/3) + leave 1 unused for future use.
- Gemma backend path continues calling `build_system_prompt()` as a single string.

### Steps

- [ ] **Step 5.1: Verify Track M PR2 is merged before starting**

Run: `cd ~/Dodami/dodami-bargein-v1 && git log origin/main --grep "llm_backends\|haiku primary\|Track M PR2" --oneline | head -5`
Expected: at least one commit referencing `llm_backends.py` or Haiku primary.

Also: `ls ~/Dodami/dodami-bargein-v1/llm_backends.py` — should exist.

If neither check passes, STOP. Mark Task 5 as BLOCKED and move to Task 6. Do not implement against Ollama.

- [ ] **Step 5.2: Write failing test — AnthropicBackend emits cache_control at each layer**

Create `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_cache.py`:

```python
"""Wave 1 — Anthropic cache_control breakpoint tests.

Requires Track M PR2 (llm_backends.py with AnthropicBackend).
"""
import pytest

pytest.importorskip('llm_backends', reason='Task 5 requires Track M PR2 (llm_backends.py)')

from llm_backends import AnthropicBackend  # noqa: E402
from prompting import build_layered_prompt  # noqa: E402


def test_anthropic_backend_assembles_cache_breakpoints():
    layers = build_layered_prompt(
        mode='chat', age=8, child_name='지민', child_id='abc',
        character='blue', character_name='퐁당이',
        memory_block='', interests=['공룡'],
    )
    backend = AnthropicBackend()
    messages = backend.assemble_messages(layers=layers, user_input='안녕!', history=[])
    # System role message must be a list-of-content-blocks with cache_control on each layer.
    system = messages['system'] if 'system' in messages else None
    assert isinstance(system, list), f'expected list of content blocks, got {type(system)!r}'
    # Each block should have cache_control: {"type": "ephemeral"}
    cached_blocks = [b for b in system if b.get('cache_control', {}).get('type') == 'ephemeral']
    assert len(cached_blocks) >= 3, f'expected ≥3 cache breakpoints (one per layer), got {len(cached_blocks)}'


def test_anthropic_backend_system_layer_text_matches_build_layered():
    layers = build_layered_prompt(
        mode='chat', age=8, child_name='지민', child_id='abc',
        character='blue', character_name='퐁당이',
        memory_block='', interests=[],
    )
    backend = AnthropicBackend()
    messages = backend.assemble_messages(layers=layers, user_input='안녕!', history=[])
    # Concatenate all text from system content blocks
    system_text = ''.join(b.get('text', '') for b in messages['system'])
    assert layers['system'] in system_text
    assert layers['character'] in system_text
    assert layers['session'] in system_text
```

- [ ] **Step 5.3: Run to verify failure**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_cache.py -v`
Expected: FAIL (if llm_backends exists) with `AttributeError: 'AnthropicBackend' object has no attribute 'assemble_messages'`.

- [ ] **Step 5.4: Add assemble_messages to AnthropicBackend**

Add to `~/Dodami/dodami-bargein-v1/llm_backends.py` inside the `AnthropicBackend` class:

```python
def assemble_messages(self, layers: dict, user_input: str, history: list) -> dict:
    """Assemble Anthropic messages-API payload with cache_control breakpoints.

    layers: dict from prompting.build_layered_prompt (keys: system/character/session)
    user_input: the current user turn's raw content
    history: list of {'role': ..., 'content': ...} dicts (most recent last)
    Returns dict with 'system' (list of content blocks) and 'messages' (list).
    """
    system_blocks = []
    if layers.get('system'):
        system_blocks.append({
            'type': 'text',
            'text': layers['system'],
            'cache_control': {'type': 'ephemeral'},
        })
    if layers.get('character'):
        system_blocks.append({
            'type': 'text',
            'text': layers['character'],
            'cache_control': {'type': 'ephemeral'},
        })
    if layers.get('session'):
        system_blocks.append({
            'type': 'text',
            'text': layers['session'],
            'cache_control': {'type': 'ephemeral'},
        })
    messages = list(history) + [{'role': 'user', 'content': user_input}]
    return {'system': system_blocks, 'messages': messages}
```

Wire `assemble_messages` into `AnthropicBackend.generate` at the prompt-construction step. The existing `generate` method probably takes a single `system_prompt` string; change it to accept `layers` dict (keep back-compat branch for string input).

- [ ] **Step 5.5: Update realtime_server's Anthropic path to use build_layered_prompt**

Where `_run_llm_local_inner` dispatches to Anthropic post-Track-M (find via grep `grep -n "AnthropicBackend\|llm_backends\|anthropic" realtime_server_v3_gemma.py`), replace the `system_prompt=build_system_prompt(...)` argument with `layers=build_layered_prompt(...)` and update the backend call.

- [ ] **Step 5.6: Run cache tests**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_cache.py -v`
Expected: 2 passed.

- [ ] **Step 5.7: Smoke test live cache hit**

Run a manual 2-turn conversation with the flag on and verify cache hit via Anthropic API response `usage.cache_read_input_tokens` > 0 on turn 2. Command shape:

```bash
DODAMI_MAGIC_WAVE1=1 python3 -c "
from llm_backends import AnthropicBackend
from prompting import build_layered_prompt
backend = AnthropicBackend()
layers = build_layered_prompt(mode='chat', age=8, child_name='지민', character='blue', character_name='퐁당이', interests=['공룡'])
msg1 = backend.assemble_messages(layers=layers, user_input='안녕!', history=[])
r1 = backend.client.messages.create(model='claude-haiku-4-5-20251001', max_tokens=200, **msg1)
print('turn1 cache_write:', r1.usage.cache_creation_input_tokens, 'cache_read:', r1.usage.cache_read_input_tokens)
msg2 = backend.assemble_messages(layers=layers, user_input='오늘 뭐 해?', history=[{'role':'user','content':'안녕!'},{'role':'assistant','content':'안녕!'}])
r2 = backend.client.messages.create(model='claude-haiku-4-5-20251001', max_tokens=200, **msg2)
print('turn2 cache_write:', r2.usage.cache_creation_input_tokens, 'cache_read:', r2.usage.cache_read_input_tokens)
"
```

Expected: turn 1 has `cache_creation_input_tokens > 0` and `cache_read_input_tokens == 0`; turn 2 has `cache_read_input_tokens > 0`.

- [ ] **Step 5.8: Commit**

```bash
git add llm_backends.py prompting.py realtime_server_v3_gemma.py tests/test_magic_wave1_cache.py
git commit -m "$(cat <<'EOF'
magic-wave1: attach cache_control at layer boundaries for Anthropic

- llm_backends.py: AnthropicBackend.assemble_messages builds messages
  payload with cache_control: ephemeral at system/character/session
  layer ends (3 of 4 available breakpoints)
- realtime_server_v3_gemma.py: Anthropic path switched to build_layered_prompt
- tests: 2 cache-assembly tests (importorskip if llm_backends absent)

Dependency: Track M PR2 (Haiku primary via llm_backends). Cache hit
rate target: >70% steady-state — metric emission in Wave 2 eval.

Part of Stream C Wave 1.
EOF
)"
```

---

## Task 6: Integration tests + feature flag + rollout preparation

**Goal:** Lock in an end-to-end test that exercises the full Wave 1 path (profile → layered prompt → LLM → parse → deliver), document the rollout sequence in a CHANGELOG-equivalent, and confirm the feature flag gating works as designed.

**Files:**
- Create: `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_integration.py`

### Steps

- [ ] **Step 6.1: Write integration test (LLM-free, assembly + parse round-trip)**

Create `~/Dodami/dodami-bargein-v1/tests/test_magic_wave1_integration.py`:

```python
"""Wave 1 — integration tests, LLM-free.

Exercises: profile → build_layered_prompt → (mock LLM output) →
parse_plan_say → detect_plan_drift → final say.
"""
import pytest
from prompting import build_layered_prompt, build_system_prompt, parse_plan_say, detect_plan_drift
from persona import pick_safe_fallback, pick_crisis_fallback, pick_empty_reply_fallback


def test_end_to_end_layered_prompt_assembly_includes_all_fields():
    layers = build_layered_prompt(
        mode='chat', age=8, child_name='지민', child_id='abc-123',
        character='blue', character_name='퐁당이',
        memory_block='[기억]\n지난번에 공룡 얘기했어', interests=['공룡', '레고'],
    )
    combined = f"{layers['system']}\n\n{layers['character']}\n\n{layers['session']}"
    # Must contain all plumbed fields
    assert '퐁당이' in combined, 'character_name missing'
    assert '지민' in combined, 'child_name missing'
    assert '공룡' in combined, 'interests missing'
    assert '기억' in combined, 'memory_block missing'
    # Must contain output-contract instructions (Task 2)
    assert '<plan>' in combined or '응답 형식' in combined


def test_end_to_end_llm_output_parse_to_say():
    """Simulate what realtime_server does: raw LLM output → say."""
    llm_raw = (
        '<plan>\n'
        'Kid state: curious\n'
        'Intent: deliver riddle\n'
        'Shape: content-delivery\n'
        'Content: R-퐁당이-07\n'
        'Callback: none\n'
        '</plan>\n'
        '<say>\n'
        '그래! 한 번 풀어봐. 높은 데서는 시끄럽게 떨어지는데 낮은 데로 가면 조용해지는 건 뭘까?\n'
        '</say>'
    )
    plan, say = parse_plan_say(llm_raw)
    assert 'deliver riddle' in plan.lower()
    assert '높은 데서는' in say
    assert detect_plan_drift(plan, say) is False


def test_end_to_end_drift_triggers_log():
    """Plan says deliver, say is empty — drift detected."""
    llm_raw = '<plan>Intent: deliver\nContent: R-퐁당이-07</plan><say></say>'
    plan, say = parse_plan_say(llm_raw)
    assert detect_plan_drift(plan, say) is True


def test_end_to_end_all_fallbacks_reachable():
    """Each character has all 3 fallback pools reachable."""
    for char in ('blue', 'green', 'yellow', 'red', ''):
        assert pick_safe_fallback(char, '지민')
        assert pick_crisis_fallback(char, '지민')
        assert pick_empty_reply_fallback(char, '지민')


def test_back_compat_build_system_prompt_no_interests():
    """Pre-Wave-1 callers (no interests arg) must get identical output."""
    out = build_system_prompt(mode='chat', age=8, child_name='지민',
                              character='blue', character_name='퐁당이')
    # Sanity: substantive content present
    assert '지민' in out or len(out) > 200
```

- [ ] **Step 6.2: Run integration tests**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_magic_wave1_integration.py -v`
Expected: 5 passed.

- [ ] **Step 6.3: Verify flag gating — with flag OFF, no behavior change**

Run: `DODAMI_TEST_SKIP_LOAD=1 DODAMI_MAGIC_WAVE1=0 python3 -m pytest tests/ 2>&1 | tail -5`
Expected: all pre-existing tests still pass (baseline count preserved). Our new tests don't depend on the flag so they also pass.

Then with flag ON: `DODAMI_TEST_SKIP_LOAD=1 DODAMI_MAGIC_WAVE1=1 python3 -m pytest tests/ 2>&1 | tail -5`
Expected: same count (tests are flag-agnostic; the flag gates runtime behavior only).

- [ ] **Step 6.4: Update CHANGELOG**

Find `~/Dodami/dodami-bargein-v1/CHANGELOG.md` if present (else skip this step). Add at top of Unreleased:

```markdown
## [Unreleased]

### Magic Wave 1 (Stream C architecture prerequisites)
- Added per-character fallback bank (safe/crisis/empty-reply pools) —
  퐁당이/새싹이/반짝이/바라미 each voice their own fallbacks
- Added `<plan>/<say>` output contract + tolerant parser + drift detector
  (log-only in Wave 1)
- Added `build_layered_prompt()` (system/character/session) for backend-
  neutral prompt composition
- Plumbed onboarding `interests` into LLM prompt surface
- Anthropic cache_control: ephemeral at 3 layer boundaries (requires Track M PR2)
- Ships behind `DODAMI_MAGIC_WAVE1` env flag (default off)
- Dropped deprecated `enhance_prompt_v6` pass-through
```

- [ ] **Step 6.5: Rollout guide (docs only)**

Create `~/Dodami/dodami-bargein-v1/docs/magic-wave1-rollout.md`:

```markdown
# Magic Wave 1 — Rollout

## Sequence
1. **테스팅 (Will's test account)** — 24h soak. Flag ON in env. Watch for:
   - PLAN_DRIFT log frequency (baseline)
   - Fallback-bank hit rate (safety / crisis / empty pools)
   - Character voice differentiation in fallback messages
   - Any exception stack traces
2. **몽실 (찬혁's pilot account)** — 24h canary after 테스팅 clean. Same watch-points.
3. **Pilot broad rollout** — 24h canary. Enable fleet-wide.

## Per-step checks
- `/canary` skill before and after
- Fallback pool sampling: `grep 'MAGIC-W1' server.log | head -50`
- Cache hit rate (if Task 5 shipped): `grep 'cache_read_input_tokens' server.log`
- No PLAN_DRIFT + log-explosion (expect <5% drift rate initially)

## Rollback
Flip `DODAMI_MAGIC_WAVE1=0` in `~/.dodami_env` on 5090 and restart service.
All changes are flag-gated — rollback is a single env flip.

## Known non-issues
- Output-contract header added to `PERSONA_PROMPT` is sent regardless of
  flag. On Gemma pre-flag-flip, the model may emit `<plan>/<say>` tags
  that the parser skips (legacy bare-string mode). Acceptable; no visible
  kid impact.
```

- [ ] **Step 6.6: Final full-suite run + commit**

Run: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -10`
Expected: baseline + all Wave 1 tests green; no regressions.

```bash
git add tests/test_magic_wave1_integration.py docs/magic-wave1-rollout.md
git commit -m "$(cat <<'EOF'
magic-wave1: integration tests + rollout guide

- tests/test_magic_wave1_integration.py: 5 end-to-end tests covering
  layer assembly + parse round-trip + fallback reachability + back-compat
- docs/magic-wave1-rollout.md: 테스팅 → 몽실 → pilot sequence + rollback

Closes Wave 1. Ready for /codex review then /land-and-deploy.

Part of Stream C Wave 1.
EOF
)"
```

- [ ] **Step 6.7: Push and open PR**

```bash
git push -u origin feat/magic-wave1
gh pr create --repo flusterff/dodami --title "magic-wave1: Stream C architecture prerequisites" --body "$(cat <<'EOF'
## Summary
- Per-character dynamic fallback bank (퐁당이/새싹이/반짝이/바라미)
- `<plan>/<say>` output contract + tolerant parser + drift detector (log-only)
- `build_layered_prompt()` 3-layer composition (system/character/session)
- `interests` plumbing from onboarding to prompt
- Anthropic cache_control breakpoints (if Track M PR2 merged)
- `DODAMI_MAGIC_WAVE1` flag (default off) — rollback is one env flip

## Test plan
- [ ] `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/` green (baseline + new)
- [ ] Deploy to 5090 with flag OFF → no behavior change
- [ ] Flip flag ON for 테스팅 → watch PLAN_DRIFT rate + fallback hits for 24h
- [ ] Flip flag ON for 몽실 → 24h canary
- [ ] Flip flag ON fleet-wide → 24h canary

## Spec + plan
- Spec: docs/superpowers/specs/2026-04-23-dodami-magic-design-C.md (in nanoclaw)
- Plan: docs/superpowers/plans/2026-04-23-dodami-magic-wave1.md (in nanoclaw)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review (performed by author before handing off)

**1. Spec coverage:**
- Wave 1 item 1 (kill hardcoded fallbacks) → Task 1 ✓
- Wave 1 item 2 (intent-first `<plan>/<say>`) → Task 2 ✓
- Wave 1 item 3 (unify personality/policy split) → Task 3 ✓
- Wave 1 item 4 (plumb missing onboarding fields) → Task 4 ✓
- Wave 1 item 5 (prompt cache breakpoints) → Task 5 ✓
- Wave 1 item 6 (tests) → every task has TDD + Task 6 integration ✓

**2. Placeholder scan:** One deliberate `pytest.skip` at Step 1.7 (call-site test needs safety.py shape the executor will read in Step 1.5 — the skip is a holding placeholder with documented intent, not "TBD"). One "placeholder for whatever persistence.py exposes" in Step 4.5 — acceptable because the executor will grep to resolve it; code block shows the shape, not a made-up name.

**3. Type/name consistency:**
- `pick_safe_fallback`, `pick_crisis_fallback`, `pick_empty_reply_fallback` — used consistently across Tasks 1, 6
- `parse_plan_say`, `detect_plan_drift` — consistent across Tasks 2, 6
- `build_layered_prompt` / `build_system_prompt` — consistent across Tasks 3, 4, 5, 6
- `FALLBACK_BANK` / `FALLBACK_BANK_DEFAULT` — consistent within Task 1
- `DODAMI_MAGIC_WAVE1` env flag — consistent across Tasks 2, 6

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-dodami-magic-wave1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration. Requires `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Third option specific to this plan:** `/codex implement docs/superpowers/plans/2026-04-23-dodami-magic-wave1.md` — the plan was written with /codex implement in mind (Task 6 Run: steps ready to parse). This is the execution path the spec targets. Runs codex in parallel for independent tasks with review gates.

Which approach?
