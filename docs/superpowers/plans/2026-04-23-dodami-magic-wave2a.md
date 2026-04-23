# Dodami Magic — Wave 2A Implementation Plan (Character Voice Few-Shots)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Hybrid execution:** Tasks 1-3 + 12-14 are codex-executable code tasks. Tasks 4-11 are collaborative drafting sessions — Claude drafts per anchor, Will reviews in-session, codex does a Korean-quality pass after. Each Anchor task lists what Claude should draft as seed content + Will's review protocol; actual approved dialogues are captured in the commit after the session.

**Goal:** Replace adjective-heavy character cards with dialogue-first hybrid cards (8 behavioral-anchor few-shot dialogues per character) so the LLM produces reliably distinctive voice per character. Also ships 사랑이 → 새싹이 rename.

**Architecture:** Card rewrite only — no changes to prompt composition, runtime routing, or safety pipeline. The existing `get_persona_prompt(character, character_name)` in `persona.py` continues prepending character card to `PERSONA_PROMPT`; the card content is the only thing that changes. Dialogues modeled on Korean IP boundaries (종결어미 / 의문형) to teach prosody alongside behavior. Gated behind `DODAMI_MAGIC_WAVE2A=1`.

**Tech Stack:** Python 3.14, pytest + unittest, Korean prose + dialogues.

**Spec:** [`2026-04-23-dodami-magic-wave2a-design.md`](../specs/2026-04-23-dodami-magic-wave2a-design.md) · **Implementation branch:** `feat/magic-wave2a` off fresh `origin/main` in `/Users/will/nanoclaw/dodami-magic-wave1/` (standalone clone on main at `ca5edd2`).

---

## Prerequisites

1. `cd /Users/will/nanoclaw/dodami-magic-wave1 && git fetch origin && git checkout -b feat/magic-wave2a origin/main`
2. Verify HEAD commit message references `post-deploy bundle` or later: `git log --oneline -1`
3. Baseline: `DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -3` — expect `907 passed, 8 failed` (or whatever current baseline is).

---

## File Structure

| File | Role in Wave 2A |
|------|---|
| `persona.py` | Modify — rewrite 4 character cards: rename `_SARANGI_CARD` → `_SAESSAKI_CARD`, update `DEFAULT_CHARACTER_NAMES['red']`, rewrite each card's `[너의 정체성]` section (trim to 1-2 sentences), keep `[의성어/의태어]`, add `[너의 목소리 — 예시]` section with 8 dialogues, keep `[절대 쓰지 마]`. |
| `demo-onboarding.html` | Modify — 사랑이 → 새싹이 in carousel `div.carousel-name`, `alt` attributes, `charNames['red']` map. |
| `settings.py` | Modify — add `DODAMI_MAGIC_WAVE2A = os.environ.get('DODAMI_MAGIC_WAVE2A', '0') == '1'` flag. |
| `tests/test_character_cards.py` | Create — structural + IP-boundary + differentiation tests for new card format. |
| `tests/test_persona_cards.py` | Modify — 사랑이 → 새싹이 references updated. |
| `tests/integration/scenarios/wave2a_anchor_1_emotion_first.json` | Create — 1 of 8 new critical-path scenarios. |
| `tests/integration/scenarios/wave2a_anchor_2_askback_no_attribution.json` | Create. |
| `tests/integration/scenarios/wave2a_anchor_3_element_vocab.json` | Create. |
| `tests/integration/scenarios/wave2a_anchor_4_honor_rejection.json` | Create. |
| `tests/integration/scenarios/wave2a_anchor_5_content_delivery.json` | Create. |
| `tests/integration/scenarios/wave2a_anchor_6_short_answer.json` | Create. |
| `tests/integration/scenarios/wave2a_anchor_7_energy_matching.json` | Create. |
| `tests/integration/scenarios/wave2a_anchor_8_signature_move.json` | Create. |

**Files intentionally NOT changed in Wave 2A:**
- `prompting.py` — composition unchanged
- `web/ws_handler.py`, `safety.py`, `turns.py`, `realtime_server_v3_gemma.py` — no wiring changes
- `riddle.py` and content banks — Wave 2B scope
- `FALLBACK_BANK` structure — unchanged (content already 새싹이-style)

---

## Task 1: Branch + flag setup

**Files:**
- Modify: `settings.py` (add `DODAMI_MAGIC_WAVE2A` flag)

### Steps

- [ ] **Step 1.1: Create the implementation branch**

```bash
cd /Users/will/nanoclaw/dodami-magic-wave1
git fetch origin
git checkout -b feat/magic-wave2a origin/main
git log --oneline -1  # verify: should be post Wave 1 hotfix bundle
```

- [ ] **Step 1.2: Add the Wave 2A flag to settings.py**

Read the current `settings.py` to locate where `DODAMI_MAGIC_WAVE1` is defined (it's an `os.environ.get(...) == '1'` pattern near the bottom). Add the Wave 2A flag immediately below it, matching the same pattern.

Edit `/Users/will/nanoclaw/dodami-magic-wave1/settings.py` — find:

```python
DODAMI_MAGIC_WAVE1 = os.environ.get('DODAMI_MAGIC_WAVE1', '0') == '1'
```

And add on the next line:

```python
# Wave 2A — Stream C character voice few-shots + 사랑이 → 새싹이 rename.
# Gates future rollout triggers; does NOT gate the new card content
# itself (cards are active unconditionally once merged, per Wave 1's
# flag-as-observability pattern).
DODAMI_MAGIC_WAVE2A = os.environ.get('DODAMI_MAGIC_WAVE2A', '0') == '1'
```

Also add `'DODAMI_MAGIC_WAVE2A',` to the `__all__` list near the bottom of settings.py (search for `'DODAMI_MAGIC_WAVE1',` and add the new entry on the line after).

- [ ] **Step 1.3: Run test suite to confirm nothing broke**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -3
```

Expected: same pass count as baseline (907 or current). The flag add is additive — no test should fail.

- [ ] **Step 1.4: Commit the flag**

```bash
git add settings.py
git commit -m "wave2a: add DODAMI_MAGIC_WAVE2A flag"
```

---

## Task 2: 사랑이 → 새싹이 rename sweep

**Files:**
- Modify: `persona.py` (variable + default name + card dict key value + any in-card prose)
- Modify: `demo-onboarding.html` (carousel name, alt, charNames)
- Modify: `tests/test_persona_cards.py` (if any 사랑이 references)
- Test: search for any other 사랑이 references in source / tests / scenarios

### Steps

- [ ] **Step 2.1: Write the failing test — no `사랑이` references in code**

Create `tests/test_wave2a_rename.py`:

```python
"""Wave 2A — rename 사랑이 → 새싹이 guard.

Regression test: ensures no `사랑이` string survives in code, HTML, or
integration scenarios after the Wave 2A rename lands. Comments in git
history are fine; stored pilot profiles on disk may still have 사랑이
(back-compat). This test covers repo source files only.
"""
import os
import subprocess
import unittest


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoSarangiInSourceTests(unittest.TestCase):

    def _grep_source(self, pattern):
        """grep across .py / .html / .json / .md in the repo, excluding
        common vendored/artifact dirs. Returns list of matching lines."""
        result = subprocess.run(
            [
                'grep', '-rEn', pattern, REPO_ROOT,
                '--include=*.py', '--include=*.html',
                '--include=*.json', '--include=*.md',
                '--exclude-dir=.git', '--exclude-dir=__pycache__',
                '--exclude-dir=node_modules', '--exclude-dir=backups',
                '--exclude-dir=app.safe-backup', '--exclude-dir=app-refactor',
                '--exclude-dir=archive',
            ],
            capture_output=True, text=True,
        )
        return [line for line in result.stdout.splitlines() if line]

    def test_no_사랑이_in_source(self):
        hits = self._grep_source('사랑이')
        # Allow intentional history-preservation mentions inside CHANGELOG-
        # like comment blocks or commit-message quotes inside .md. Filter
        # those out by requiring the hit NOT to be in a markdown file or
        # on a line containing the word 'rename' / 'history'.
        live_hits = [
            line for line in hits
            if not line.lower().endswith('.md') and 'rename' not in line.lower()
        ]
        self.assertEqual(
            live_hits, [],
            f'found live 사랑이 references after rename:\n  ' +
            '\n  '.join(live_hits),
        )

    def test_새싹이_in_persona_module(self):
        hits = self._grep_source('새싹이')
        # Must appear at least in persona.py and demo-onboarding.html.
        hit_files = {line.split(':', 1)[0] for line in hits}
        self.assertTrue(
            any(p.endswith('persona.py') for p in hit_files),
            f'새싹이 not found in persona.py. Hit files: {hit_files}',
        )
        self.assertTrue(
            any(p.endswith('demo-onboarding.html') for p in hit_files),
            f'새싹이 not found in demo-onboarding.html. Hit files: {hit_files}',
        )


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 2.2: Run the test — confirm it fails**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_wave2a_rename.py -v
```

Expected: 2 failures. `test_no_사랑이_in_source` fails because persona.py + demo-onboarding.html still have `사랑이`. `test_새싹이_in_persona_module` fails because 새싹이 isn't there yet.

- [ ] **Step 2.3: Do the rename in persona.py — variable + default name**

Edit `/Users/will/nanoclaw/dodami-magic-wave1/persona.py`:

1. Find the variable declaration `_SARANGI_CARD = """[너의 정체성 — {name}]` (around line 448). Rename the variable to `_SAESSAKI_CARD`.
2. In the card text itself, replace any explicit `사랑이` references with `{name}` placeholders if not already using `{name}`. Scan the card body for the literal string and rewrite. (The existing card should already use `{name}` throughout — this is a safety check.)
3. Find `CHARACTER_CARDS = {` (around line 466) and change `'red': _SARANGI_CARD,` to `'red': _SAESSAKI_CARD,`.
4. Find `DEFAULT_CHARACTER_NAMES = {` (around line 481) and change `'red': '사랑이',` to `'red': '새싹이',`.

- [ ] **Step 2.4: Do the rename in demo-onboarding.html**

Edit `/Users/will/nanoclaw/dodami-magic-wave1/demo-onboarding.html`:

1. Find `alt="사랑이"` (multiple occurrences — carousel + other sections). Change each to `alt="새싹이"`.
2. Find `<div class="carousel-name">사랑이</div>` and change to `<div class="carousel-name">새싹이</div>`.
3. Find the `charNames` JavaScript map (search for `const charNames = {`) and change `red: '사랑이'` to `red: '새싹이'`.

- [ ] **Step 2.5: Sweep other source files for 사랑이**

```bash
cd /Users/will/nanoclaw/dodami-magic-wave1
grep -rEn '사랑이' --include='*.py' --include='*.html' --include='*.json' --include='*.md' \
  --exclude-dir=.git --exclude-dir=__pycache__ --exclude-dir=node_modules \
  --exclude-dir=backups --exclude-dir=app.safe-backup --exclude-dir=app-refactor \
  --exclude-dir=archive
```

For each remaining live hit (not .md rename history, not backup dirs), edit the file and rename to 새싹이. Common targets: `tests/test_persona_cards.py`, any scenario JSON that references character names by Korean name, mode-greeting strings in `persona.py` if any.

- [ ] **Step 2.6: Run the rename test — confirm it passes**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_wave2a_rename.py -v
```

Expected: both tests pass.

- [ ] **Step 2.7: Run full suite — confirm no regression**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -3
```

Expected: baseline + 2 new tests = 909 passed, 8 pre-existing failures unchanged.

- [ ] **Step 2.8: Commit**

```bash
git add persona.py demo-onboarding.html tests/test_wave2a_rename.py tests/test_persona_cards.py
# plus any other files touched by the sweep in Step 2.5
git commit -m "wave2a: rename 사랑이 → 새싹이 (red character)

Red character renamed from 사랑이 to 새싹이 to match Stream C rev-2
spec (뿌리 element; 새싹 = sprout-from-root). Touched:
- persona.py: _SARANGI_CARD → _SAESSAKI_CARD, DEFAULT_CHARACTER_NAMES
- demo-onboarding.html: carousel name + alt + charNames map
- tests/test_persona_cards.py + any other scenario/test refs

Regression test tests/test_wave2a_rename.py guards against future
reintroduction. 2 new tests, baseline + 2 = 909 passed."
```

---

## Task 3: Card-structure test scaffolding

**Files:**
- Create: `tests/test_character_cards.py`
- Modify: (none yet — tests for structure pre-date dialogue content)

### Steps

- [ ] **Step 3.1: Write the scaffold tests**

Create `tests/test_character_cards.py`:

```python
"""Wave 2A — character card structural + prosodic invariants.

These tests run against the card text AFTER character name substitution.
Run with DODAMI_TEST_SKIP_LOAD=1 to skip runtime model loading.
"""
import os
import re
import sys
import unittest

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)

from persona import (
    CHARACTER_CARDS,
    DEFAULT_CHARACTER_NAMES,
    get_persona_prompt,
)


# Korean sentence-final + question endings. These are the IP-boundary
# markers Dodami's dialogue turns should land on. Matches 종결어미 and
# common 의문형. Kept narrow to catch drift.
_IP_ENDING_RE = re.compile(
    r'('
    # Declarative / confirmational
    r'다|요|네|야|어|지|군|구나|라|거든|잖아|'
    # Interrogative
    r'니|까|냐|래|죠|'
    # Questioning particles
    r'ㄹ까|ㄹ래'
    r')[.?!~]*\s*$'
)


class CardStructureTests(unittest.TestCase):

    def setUp(self):
        self.cards = {
            color: CHARACTER_CARDS[color].format(
                name=DEFAULT_CHARACTER_NAMES[color]
            )
            for color in ('blue', 'red', 'yellow', 'green')
        }

    def test_all_four_colors_present(self):
        self.assertEqual(
            set(self.cards.keys()),
            {'blue', 'red', 'yellow', 'green'},
        )

    def test_each_card_has_identity_section(self):
        for color, text in self.cards.items():
            self.assertIn(
                '[너의 정체성',
                text,
                f'{color} card missing 너의 정체성 section',
            )

    def test_each_card_has_examples_section(self):
        for color, text in self.cards.items():
            self.assertIn(
                '[너의 목소리 — 예시]',
                text,
                f'{color} card missing 너의 목소리 — 예시 section',
            )

    def test_each_card_has_forbidden_section(self):
        for color, text in self.cards.items():
            self.assertIn(
                '[절대 쓰지 마]',
                text,
                f'{color} card missing 절대 쓰지 마 section',
            )

    def test_character_name_substitutes(self):
        # 'red' should substitute 새싹이, not 사랑이
        red_card = self.cards['red']
        self.assertIn('새싹이', red_card)
        self.assertNotIn('사랑이', red_card)
        self.assertNotIn('{name}', red_card)  # template not escaped

    def test_all_four_characters_differentiated(self):
        # No two cards should be byte-identical (catches accidental
        # copy-paste). Also no two should have identical [너의 정체성]
        # bodies.
        texts = list(self.cards.values())
        self.assertEqual(
            len(set(texts)), 4,
            'two or more cards have identical full text',
        )

    def test_get_persona_prompt_composes(self):
        # Smoke test: get_persona_prompt returns a non-empty prompt for
        # each character that contains both the card and PERSONA_PROMPT.
        for color, expected_name in DEFAULT_CHARACTER_NAMES.items():
            out = get_persona_prompt(color, expected_name)
            self.assertIn(expected_name, out)
            self.assertIn('응답 형식', out)  # output-contract header


if __name__ == '__main__':
    unittest.main()
```

- [ ] **Step 3.2: Run — expect mixed pass/fail**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_character_cards.py -v
```

Expected: `test_all_four_colors_present`, `test_each_card_has_identity_section`, `test_each_card_has_forbidden_section`, `test_character_name_substitutes`, `test_all_four_characters_differentiated`, `test_get_persona_prompt_composes` PASS. `test_each_card_has_examples_section` FAIL — the cards don't have `[너의 목소리 — 예시]` section yet.

The failing test is intentional — Tasks 4-11 each add dialogues into that section; by Task 11 the test goes green.

- [ ] **Step 3.3: Commit the scaffolding**

```bash
git add tests/test_character_cards.py
git commit -m "wave2a: add character card structural tests (scaffold)

7 tests covering section presence, name substitution, character
differentiation, and get_persona_prompt composition. One test
(test_each_card_has_examples_section) currently fails intentionally;
Tasks 4-11 (anchor drafting) fill in the [너의 목소리 — 예시] section
and the test goes green at Task 11."
```

---

## Tasks 4-11: Anchor-parallel dialogue drafting

**Collaborative cycle, repeated 8 times.** Each anchor task follows the same structure:

1. Claude drafts 4 dialogues (1 per character: blue/red/yellow/green → 퐁당이/새싹이/반짝이/바라미) demonstrating the anchor behavior in character voice.
2. Will reviews in-session — edits voice, Korean naturalness, anchor clarity.
3. Codex reviews final 4 dialogues for Korean grammar + IP-boundary endings + no forbidden-pattern violations.
4. Dialogues get inserted into a running draft file `tests/fixtures/wave2a_dialogues_wip.md`.
5. Commit the draft updates — DO NOT modify `persona.py` yet (final assembly happens in Task 12).

**Dialogue format constraints** (apply to every dialogue):
- 2-3 turns (kid → Dodami [→ kid → Dodami])
- Kid speech: realistic 6-12yo Korean, 반말, age-appropriate interjections
- Dodami turns end at 종결어미 (-다, -지, -네, -야, -어, -요) or 의문형 (-까, -니, -냐, -래). ALL Dodami turns, no exceptions.
- No `|||` multi-turn delimiters
- Optional (not required per dialogue): natural placement of character's element vocab
- Each anchor dialogue demonstrates ONE behavior clearly — judge should be able to name the anchor from the dialogue alone

---

### Task 4: Anchor 1 — Emotion-first-content-second

**What this anchor teaches:** Dodami acknowledges the kid's feeling BEFORE delivering information or asking a probing question. Korean CDS pattern — emotion first, content follows.

**Files:**
- Create (or append to if exists): `tests/fixtures/wave2a_dialogues_wip.md`

- [ ] **Step 4.1: Claude drafts 4 seed dialogues**

One per character, each showing emotion-first-content-second. Seed example for 새싹이 (root/empathy — this character's natural signature):

```markdown
## Anchor 1 — Emotion-first-content-second

### 새싹이 (red / 뿌리)
Kid: 오늘 학교에서 친구랑 싸웠어.
새싹이: 아이고, 속상했겠다. 어떤 일이 있었어?

### 퐁당이 (blue / 물) [DRAFT]
Kid: [TBD in session — a situation where kid expresses a complex feeling]
퐁당이: [emotion acknowledgment in 퐁당이's 차분/reflective voice] ... [curious follow-up]

### 반짝이 (yellow / 빛) [DRAFT]
Kid: [TBD — a moment of mixed emotion, maybe excited+nervous]
반짝이: [bright warm acknowledgment, not dismissive of the concern] ... [specific celebration or follow-up]

### 바라미 (green / 바람) [DRAFT]
Kid: [TBD — something where kid notices a small detail about their feeling]
바라미: [playful acknowledgment that connects the feeling to something concrete] ... [connection to new topic/question]
```

The 새싹이 seed shows the shape: emotion marker (`아이고, 속상했겠다`) → open follow-up (`어떤 일이 있었어?`). All 3 remaining dialogues preserve this SHAPE but adapt the vocabulary + tone to each character's voice.

- [ ] **Step 4.2: Will reviews + edits in-session**

Will's review protocol (for EACH of the 4 dialogues):
- Character voice — does 퐁당이 sound like 퐁당이? (Read aloud, feel register.)
- Anchor clarity — can a reviewer who sees only this dialogue name "emotion-first" as the behavior? If no, clarify.
- Korean naturalness — no 번역투 ("좋은 질문이야"), no dismissive ("그래 그래"), no forced onomatopoeia.
- Kid turn realism — 6-12yo Korean, not textbook dialog.
- IP-boundary check — Dodami's final turn ends in 종결어미 or 의문형.

Iterate until all 4 are locked.

- [ ] **Step 4.3: Codex reviews the 4 approved dialogues**

Dispatch codex for Korean grammar + naturalness + IP-ending + forbidden-pattern compliance. Report format: per-dialogue list of issues + verdict (PASS / FIX / REJECT). Fix any PASS-with-fix items in-session; reject items go back to Will for re-draft.

- [ ] **Step 4.4: Append approved dialogues to WIP fixture**

Append the 4 approved dialogues to `tests/fixtures/wave2a_dialogues_wip.md` under `## Anchor 1 — Emotion-first-content-second`.

- [ ] **Step 4.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 1: emotion-first-content-second × 4 characters

4 dialogues approved (퐁당이/새싹이/반짝이/바라미) showing emotion
acknowledgment before content delivery. Codex Korean-quality review
clean. Pattern locked for anchors 2-8."
```

---

### Task 5: Anchor 2 — Ask-back without attribution

**What this anchor teaches:** When the kid's input contains "왜" in an attribution/complaint context ("왜 기억을 못 해", "왜 이렇게 멍청해"), Dodami does NOT fire a Socratic ask-back. Socratic ask-back is for thinkable curiosity ("왜 하늘이 파래?"); attribution 왜 gets an acknowledgment + repair, not a thought-question flip.

**Files:**
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (append)

- [ ] **Step 5.1: Claude drafts 4 seed dialogues**

Seed example for 퐁당이:

```markdown
## Anchor 2 — Ask-back without attribution

### 퐁당이 (blue / 물)
Kid: 너는 왜 그렇게 느릿느릿해?
퐁당이: 음~ 나는 천천히 듣고 싶어서. 네가 한 말 잘 들으려고 그래. 뭐 하고 싶어?
```

The shape: acknowledge the attribution itself (not flip it), offer a brief reason if natural, pivot to kid's agenda. No "너는 왜 그렇게 생각해?" reflex.

Draft analogous seeds for:
- **새싹이 (red / 뿌리)**: kid attributes something negatively ("왜 그렇게 조용해?"), 새싹이 grounds the response ("음~ 나는 네 얘기 기다렸어. 뭐 생각했어?")
- **반짝이 (yellow / 빛)**: kid accuses rigidity ("왜 맨날 똑같은 거 해?"), 반짝이 redirects with energy ("아 정말? 그럼 오늘은 완전 다른 거 하자! 뭐 하고 싶어?")
- **바라미 (green / 바람)**: kid pokes with a hypothetical ("왜 사람마다 꿈이 달라?" — this is thinkable, so handle DIFFERENTLY: this one DOES warrant Socratic. Write it as the contrast — 바라미 SHOULD do a light ask-back here, showing the LLM when the flip IS appropriate.)

The 바라미 dialogue is the "contrast case" — explicitly shows attribution ≠ curiosity, same character can do both depending on kid intent.

- [ ] **Step 5.2: Will reviews + edits in-session**

Same review protocol as Task 4.2. Extra scrutiny on:
- Does each dialogue UNAMBIGUOUSLY show attribution vs curiosity 왜? The 바라미 contrast case is especially important.
- No repair that sounds sycophantic ("아이고, 미안해 미안해").

- [ ] **Step 5.3: Codex Korean-quality review**

Same as Task 4.3.

- [ ] **Step 5.4: Append approved dialogues**

Append to `tests/fixtures/wave2a_dialogues_wip.md` under `## Anchor 2 — Ask-back without attribution`.

- [ ] **Step 5.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 2: ask-back without attribution × 4 characters

Fixes the Socratic misfire class observed in 2026-04-23 pilot session
(kid vents 왜, LLM reflex-flips to 너는 왜 그런 것 같아). Includes
바라미 contrast case showing ask-back IS correct for thinkable 왜."
```

---

### Task 6: Anchor 3 — Element-vocab in context

**What this anchor teaches:** Each character uses their element's vocabulary (onomatopoeia, metaphors) naturally in-context — not shoehorned, not skipped. The word should serve the meaning, not the other way around.

**Per-character target vocab** (from existing `[의성어/의태어]` sections):
- 퐁당이 (blue / 물): 퐁당, 졸졸, 찰랑찰랑, 잔잔히, 똑똑
- 새싹이 (red / 뿌리): 포근포근, 꼬옥, 따끈따끈, 살살, + root/growth words (뿌리, 자라나)
- 반짝이 (yellow / 빛): 반짝반짝, 휘리릭, 팡!, 샤랄라, 쨔잔~
- 바라미 (green / 바람): 솨~, 살랑살랑, 팔랑, 훨훨, 살금살금

**Files:**
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (append)

- [ ] **Step 6.1: Claude drafts 4 seed dialogues**

Seed example for 바라미:

```markdown
## Anchor 3 — Element-vocab in context

### 바라미 (green / 바람)
Kid: 오늘 나뭇잎 떨어지는 거 봤어.
바라미: 와, 어디서? 살랑살랑 내려왔어, 아니면 훨훨 날아갔어?
```

The vocab (`살랑살랑`, `훨훨`) serves the actual sensory question — it's inside the observation, not a mannerism decoration at the start.

Draft analogous seeds for:
- **퐁당이**: kid mentions a sound or feeling; 퐁당이 uses 찰랑찰랑 / 졸졸 inside the description, not at the opening exclamation
- **새싹이**: kid shares something emotional; 새싹이 uses 포근 / 꼬옥 as the feel of the response, inside the empathy clause
- **반짝이**: kid reports a discovery; 반짝이 uses 반짝반짝 / 팡 inside the celebration, mapped to the discovery itself

- [ ] **Step 6.2: Will reviews + edits in-session**

Extra scrutiny: is the vocab doing SEMANTIC work, or is it ornamental? If ornamental, cut it or replace with a more natural choice.

- [ ] **Step 6.3: Codex Korean-quality review**

Extra check: flag any onomatopoeia that's syntactically awkward or collocates weirdly with the surrounding verb.

- [ ] **Step 6.4: Append approved dialogues**

Same pattern as prior tasks.

- [ ] **Step 6.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 3: element-vocab in context × 4 characters"
```

---

### Task 7: Anchor 4 — Honor 싫어 / 괜찮아

**What this anchor teaches:** When kid says "싫어" / "괜찮아" / "그만" / "됐어", Dodami pivots IMMEDIATELY and does not re-propose the rejected topic for the remaining turns of the dialogue. Also: no guilt-tripping, no "왜 싫어?", no persuading.

**Files:**
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (append)

- [ ] **Step 7.1: Claude drafts 4 seed dialogues — 3-turn format**

These MUST be 3-turn dialogues so we can show the pivot AND the sustained non-re-proposal. 2-turn is insufficient for this anchor.

Seed example for 새싹이:

```markdown
## Anchor 4 — Honor 싫어 / 괜찮아

### 새싹이 (red / 뿌리)
Kid: (after 새싹이 suggests a math problem) 아 수학 싫어.
새싹이: 알겠어. 그럼 오늘은 뭐 하고 싶어?
Kid: 그냥 얘기하고 싶어.
새싹이: 그래. 오늘 뭐 있었어?
```

The pivot is clean ("알겠어. 그럼 ..."), open-ended, and 새싹이 never brings 수학 back in turn 3+.

Draft analogous for perfectly clear pivots in:
- **퐁당이** (kid rejects riddle mode)
- **반짝이** (kid says "그만" to a story)
- **바라미** (kid says "됐어" to a hypothetical game)

- [ ] **Step 7.2: Will reviews + edits**

Extra scrutiny:
- Pivot language is neutral/warm, not passive-aggressive ("아 그래... 음...")
- Turn 3+ does NOT re-propose. Even a "혹시 나중에 수학 해볼래?" is a fail — must genuinely drop it.
- No extra condition attached ("그래 근데 다음엔 꼭 해보자!").

- [ ] **Step 7.3: Codex review**

- [ ] **Step 7.4: Append approved dialogues**

- [ ] **Step 7.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 4: honor 싫어/괜찮아 × 4 characters (3-turn dialogues)"
```

---

### Task 8: Anchor 5 — Content-delivery handoff

**What this anchor teaches:** When Dodami commits to delivering content ("수수께끼 하나 내줄게" / "내가 이야기 하나 해줄게" / "게임 해보자"), the content actually appears IN THE SAME TURN. Fixes the "promise-without-delivery" bug class (riddle-harder misfire was one instance).

**Files:**
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (append)

- [ ] **Step 8.1: Claude drafts 4 seed dialogues**

Each dialogue must show the full commit-AND-deliver pattern in ONE Dodami turn. No "here's the riddle!" [next turn] "okay here it is: ..."

Seed example for 퐁당이:

```markdown
## Anchor 5 — Content-delivery handoff

### 퐁당이 (blue / 물)
Kid: 수수께끼 하나 내봐.
퐁당이: 그래! 한 번 맞춰봐. 바위 위에서도 흐르고 모래 위에서도 흐르는 건 뭘까?
```

Notice: "그래!" (commit) + "한 번 맞춰봐." (hand-off framing) + actual riddle (delivery), all one turn.

Draft analogous for:
- **새싹이**: kid asks for a story, 새싹이 commits + opens story in same turn
- **반짝이**: kid asks for a game, 반짝이 commits + gives game prompt in same turn
- **바라미**: kid asks for a fact, 바라미 commits + gives fact + asks follow-up in same turn

- [ ] **Step 8.2: Will reviews + edits**

Extra scrutiny:
- Does the Dodami turn actually CONTAIN deliverable content? (Not just "I'll give you a riddle" with no riddle.)
- Is the content itself reasonable? (The 퐁당이 seed uses a riddle from the existing bank.)

- [ ] **Step 8.3: Codex review**

- [ ] **Step 8.4: Append approved dialogues**

- [ ] **Step 8.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 5: content-delivery handoff × 4 characters (fixes promise-without-delivery)"
```

---

### Task 9: Anchor 6 — Short-answer handling

**What this anchor teaches:** When kid replies with a 1-syllable/vague answer ("응" / "몰라" / "그냥" / "아니" / "음"), Dodami does NOT re-ask the same question. Instead offers a concrete, specific alternative — typically a pair of options or a single commitment.

**Files:**
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (append)

- [ ] **Step 9.1: Claude drafts 4 seed dialogues**

Seed example for 반짝이:

```markdown
## Anchor 6 — Short-answer handling

### 반짝이 (yellow / 빛)
반짝이: 오늘 학교에서 뭐 재밌는 거 있었어?
Kid: 몰라.
반짝이: 그럼 내가 퀴즈 하나 낼까, 아니면 재밌는 얘기 들려줄까?
```

Notice 반짝이's response: didn't re-ask "무슨 재밌는 거 있었는지 말해봐?" — instead offered TWO concrete choices in 반짝이's energetic voice.

Draft analogous for:
- **퐁당이**: kid says "응" — 퐁당이 offers a calm pair
- **새싹이**: kid says "그냥" — 새싹이 offers a gentle commit ("그럼 내가 먼저 이야기 하나 해줄게")
- **바라미**: kid says "아니" — 바라미 offers an unexpected pivot + question

- [ ] **Step 9.2: Will reviews + edits**

Extra scrutiny:
- Dodami's next turn doesn't RE-ASK the same question (that's the failure mode)
- Alternative is CONCRETE, not open-ended "그럼 뭐 하고 싶어?"
- Pair-of-options or single-commit, not a menu of 5+

- [ ] **Step 9.3: Codex review**

- [ ] **Step 9.4: Append approved dialogues**

- [ ] **Step 9.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 6: short-answer handling × 4 characters"
```

---

### Task 10: Anchor 7 — Energy matching

**What this anchor teaches:** Dodami matches the kid's energy level. Excited kid → raised energy response (not forced). Tired kid → calmer response (not flat). Frustrated kid → steady + grounded. Mismatched affect is a major failure mode for kid UX.

**Files:**
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (append)

- [ ] **Step 10.1: Claude drafts 4 seed dialogues**

Each character shows ONE energy match — but from different starting states, so across the 4 we cover excited/tired/frustrated/neutral.

Seed example for 반짝이 (high energy inherent to character; here handling a TIRED kid, the harder case):

```markdown
## Anchor 7 — Energy matching

### 반짝이 (yellow / 빛)
Kid: 오늘 너무 피곤해...
반짝이: 그렇구나, 오늘 많이 바빴지. 잠깐 쉬어가자. 물 한 잔 마시고 올래?
```

Notice 반짝이 LOWERS energy here — no "와!!!" no onomatopoeia. Shows the character's range, not monotone.

Draft analogous for:
- **퐁당이** handles an EXCITED kid (퐁당이 raises energy without losing its reflective center)
- **새싹이** handles a FRUSTRATED kid (새싹이 grounds, doesn't cheerlead)
- **바라미** handles a NEUTRAL kid (바라미 raises engagement without forcing)

- [ ] **Step 10.2: Will reviews + edits**

Extra scrutiny:
- Is the energy MATCH clear, or is it just character voice? (The 반짝이 seed is quieter than typical 반짝이 — that's the point.)
- Does the dialogue show RANGE within the character, or collapse to the character's default?

- [ ] **Step 10.3: Codex review**

- [ ] **Step 10.4: Append approved dialogues**

- [ ] **Step 10.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 7: energy matching × 4 characters (shows range, not monotone)"
```

---

### Task 11: Anchor 8 — Character signature move

**What this anchor teaches:** Each character has a unique response-shape pattern that makes them recognizable:
- 퐁당이: **emotion-tag → curious follow-up**
- 새싹이: **affirm feeling → soft question**
- 반짝이: **amplify ONE specific thing → celebrate**
- 바라미: **notice a detail → connect to different topic**

Each character's dialogue here should demonstrate ITS OWN signature move.

**Files:**
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (append)

- [ ] **Step 11.1: Claude drafts 4 seed dialogues, one per signature**

Seed example for 바라미 ("notice detail → connect"):

```markdown
## Anchor 8 — Character signature move

### 바라미 (green / 바람)
Kid: 친구가 오늘 새 신발 신고 왔어.
바라미: 오, 색깔 눈에 띄었어? 그러고 보니 요즘 네가 좋아하는 색 있어?
```

Notice: notices a specific detail (색깔) then PIVOTS to a different angle (네 취향). That's 바라미's signature — observational, connective, not stuck on the original subject.

Draft analogous for each character's signature:
- **퐁당이 (emotion-tag → curious follow-up)**: seed dialogue shows emotion word + genuine follow-up question
- **새싹이 (affirm → soft question)**: affirmation of kid's statement + open gentle question
- **반짝이 (amplify one → celebrate)**: picks ONE point from kid's utterance + celebrates it (not generic "대단해!")

- [ ] **Step 11.2: Will reviews + edits**

Extra scrutiny:
- Each signature MUST be distinguishable from the others. A blind reader should be able to match dialogue → character based on signature shape.
- Signature is about SHAPE (flow, pattern) not just vocabulary.

- [ ] **Step 11.3: Codex review**

- [ ] **Step 11.4: Append approved dialogues**

- [ ] **Step 11.5: Commit**

```bash
git add tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a anchor 8: character signature move × 4 characters"
```

---

## Task 12: Final card assembly

**Files:**
- Modify: `persona.py` (rewrite all 4 character cards)
- Modify: `tests/fixtures/wave2a_dialogues_wip.md` (promote from WIP → delete, content is now inlined in persona.py)

### Steps

- [ ] **Step 12.1: Read the WIP fixture**

```bash
cat tests/fixtures/wave2a_dialogues_wip.md
```

You now have 32 approved dialogues organized by anchor × character. Re-group by CHARACTER for the final cards:
- 퐁당이 gets all 8 of its dialogues (one per anchor)
- 새싹이 gets all 8 of its dialogues
- 반짝이 gets all 8 of its dialogues
- 바라미 gets all 8 of its dialogues

- [ ] **Step 12.2: Rewrite each character card**

For each of 4 cards in `persona.py`, replace the current content with the new structure:

```python
_PONGDANGI_CARD = """[너의 정체성 — {name}]
너는 {name}. 도담이 중에서 물 원소 친구야. 차분하고 깊게 듣는 친구.

[의성어/의태어]
퐁당, 졸졸, 찰랑찰랑, 잔잔히, 똑똑

[너의 목소리 — 예시]

Kid: [anchor 1 kid turn]
{name}: [anchor 1 {name} turn]

Kid: [anchor 2 kid turn]
{name}: [anchor 2 {name} turn]

...

Kid: [anchor 8 kid turn]
{name}: [anchor 8 {name} turn]

[절대 쓰지 마]
- "헐 대박!!" (톤 안 맞음)
- "빨리빨리 해봐" (재촉 없음)
- "음... (긴 침묵)" 반복 (차분 ≠ 지루함)
- "좋은 질문이야" / "정말 좋은 질문이야" (번역투 금지)
"""
```

For each character:
1. Keep the `[너의 정체성 — {name}]` but SHORTEN to 1-2 sentences (down from 6 bullets)
2. Keep the `[의성어/의태어]` list exactly as-is
3. Replace all the middle bullet sections with `[너의 목소리 — 예시]` containing the 8 approved dialogues from the WIP fixture (in anchor order)
4. Keep the `[절대 쓰지 마]` section but trim to 4-5 most-important items (down from longer list if needed)
5. Use `{name}` for any character-name references inside the dialogues (since the card is Python-formatted later)

Note: `_SARANGI_CARD` was already renamed to `_SAESSAKI_CARD` in Task 2 — you're rewriting the body, not the variable.

- [ ] **Step 12.3: Delete the WIP fixture**

```bash
rm tests/fixtures/wave2a_dialogues_wip.md
```

(Content is now inlined in persona.py; no reason to keep the intermediate file.)

- [ ] **Step 12.4: Run character card tests**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_character_cards.py -v
```

Expected: ALL tests pass now, including `test_each_card_has_examples_section` (previously failing).

- [ ] **Step 12.5: Add dialogue-count test + IP-ending test**

Append to `tests/test_character_cards.py`:

```python
class CardContentTests(unittest.TestCase):

    def setUp(self):
        self.cards = {
            color: CHARACTER_CARDS[color].format(
                name=DEFAULT_CHARACTER_NAMES[color]
            )
            for color in ('blue', 'red', 'yellow', 'green')
        }

    def _examples_section(self, card_text):
        """Return the body of [너의 목소리 — 예시] section."""
        start = card_text.find('[너의 목소리 — 예시]')
        end = card_text.find('[절대 쓰지 마]', start)
        assert start != -1 and end != -1 and end > start
        return card_text[start:end]

    def test_each_card_has_eight_dialogues(self):
        # Count "Kid:" occurrences in [너의 목소리 — 예시] section.
        # A 2-turn dialogue has 1 "Kid:" prefix; 3-turn has 2. Per
        # spec D4 we allow 2-3 turns, so count distinct DIALOGUES by
        # blank-line separation between exchanges.
        for color, card in self.cards.items():
            body = self._examples_section(card)
            # Each dialogue block is separated by a blank line (or two).
            # Count blocks that contain at least one "Kid:" line.
            blocks = [
                b for b in body.split('\n\n')
                if 'Kid:' in b
            ]
            self.assertEqual(
                len(blocks), 8,
                f'{color} card has {len(blocks)} dialogues, expected 8'
            )

    def test_dodami_turns_end_at_ip_boundary(self):
        # Every Dodami turn in the examples must end in 종결어미 or 의문형.
        name_to_color = {v: k for k, v in DEFAULT_CHARACTER_NAMES.items()}
        for color, card in self.cards.items():
            body = self._examples_section(card)
            name = DEFAULT_CHARACTER_NAMES[color]
            dodami_lines = [
                line.strip()
                for line in body.split('\n')
                if line.strip().startswith(f'{name}:')
            ]
            for line in dodami_lines:
                content = line[len(name) + 1:].strip()  # strip "{name}: "
                # Check the FINAL utterance (if multi-sentence, the last).
                # Split on sentence terminators but keep terminator attached.
                sentences = re.split(r'(?<=[.?!~])\s+', content)
                last = sentences[-1] if sentences else content
                self.assertRegex(
                    last, _IP_ENDING_RE,
                    f'{color} Dodami line does not end at IP boundary: {line!r}'
                )
```

- [ ] **Step 12.6: Run new tests**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/test_character_cards.py -v
```

Expected: ALL tests pass. If `test_dodami_turns_end_at_ip_boundary` fails, go back and fix any dialogue lines that don't end in 종결어미.

- [ ] **Step 12.7: Run full suite**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -3
```

Expected: baseline + new Wave 2A tests all green. Pre-existing 8 failures unchanged.

- [ ] **Step 12.8: Commit**

```bash
git add persona.py tests/test_character_cards.py
git rm tests/fixtures/wave2a_dialogues_wip.md
git commit -m "wave2a: final card assembly — 4 characters × 8 anchor dialogues

Each character card now has:
- [너의 정체성] — 1-2 sentence voice essence (trimmed from 6-bullet prose)
- [의성어/의태어] — per-character onomatopoeia (unchanged)
- [너의 목소리 — 예시] — 8 few-shot dialogues covering anchors 1-8
- [절대 쓰지 마] — hard rules (trimmed to 4-5 most important)

Structural + content tests added: 8-dialogue-count + Dodami-turn IP-ending
check. WIP fixture promoted to persona.py and deleted. Full suite green."
```

---

## Task 13: Pilot-replay regression scenarios

**Files:**
- Create: `tests/integration/scenarios/wave2a_anchor_1_emotion_first.json`
- Create: `tests/integration/scenarios/wave2a_anchor_2_askback_no_attribution.json`
- Create: `tests/integration/scenarios/wave2a_anchor_3_element_vocab.json`
- Create: `tests/integration/scenarios/wave2a_anchor_4_honor_rejection.json`
- Create: `tests/integration/scenarios/wave2a_anchor_5_content_delivery.json`
- Create: `tests/integration/scenarios/wave2a_anchor_6_short_answer.json`
- Create: `tests/integration/scenarios/wave2a_anchor_7_energy_matching.json`
- Create: `tests/integration/scenarios/wave2a_anchor_8_signature_move.json`

### Steps

- [ ] **Step 13.1: Inspect existing scenario shape for reference**

```bash
cat tests/integration/scenarios/why_ask_back_fullwidth.json
```

This shows the JSON schema: `name`, `description`, `mode`, `character` (optional), `turns` (array of `{user: "..."}`), `expect` with either `turn_specific` (list of assertions per turn) or `full_session` (global assertions).

- [ ] **Step 13.2: Create anchor 1 scenario (emotion-first)**

Create `tests/integration/scenarios/wave2a_anchor_1_emotion_first.json`:

```json
{
  "name": "wave2a_anchor_1_emotion_first",
  "description": "Wave 2A anchor 1: Dodami acknowledges emotion before delivering content. Kid reports a negative experience; first word/clause of reply should be an emotion-marker, NOT an information question.",
  "mode": "chat",
  "character": "red",
  "turns": [
    {"user": "오늘 친구랑 싸워서 기분이 안 좋아."}
  ],
  "expect": {
    "turn_specific": [
      {"reply_starts_with_any": ["아이고", "그랬구나", "속상", "어떡해", "음~ 그랬", "마음이"]}
    ]
  }
}
```

The `reply_starts_with_any` assertion checks the FIRST ~10 characters of Dodami's reply against one of several emotion-acknowledgment prefixes. If the reply jumps straight to a question or information, this fails.

Note: `reply_starts_with_any` may need to be added to the replay runner if not already present. Check `bin/pilot-replay.py` assertion handlers — grep for `reply_starts_with_any` or similar. If missing, add a simple handler that does `reply[:15].startswith(prefix)` for any prefix in the list.

- [ ] **Step 13.3: Create anchor 2 scenario (ask-back without attribution)**

```json
{
  "name": "wave2a_anchor_2_askback_no_attribution",
  "description": "Wave 2A anchor 2: Kid inputs an attribution 왜 (complaint); Dodami does NOT reflex-flip to 너는 왜 그런 것 같아. Attribution context distinguished from thinkable curiosity 왜.",
  "mode": "chat",
  "character": "blue",
  "turns": [
    {"user": "너 왜 이렇게 느려?"}
  ],
  "expect": {
    "turn_specific": [
      {"reply_excludes_any": ["너는 왜 그런", "네가 왜", "넌 왜 그렇게"]}
    ]
  }
}
```

`reply_excludes_any` checks that NONE of the listed patterns appear in the reply.

- [ ] **Step 13.4: Create anchor 3 scenario (element-vocab)**

```json
{
  "name": "wave2a_anchor_3_element_vocab",
  "description": "Wave 2A anchor 3: 퐁당이 uses water vocab (찰랑/퐁당/졸졸/잔잔) naturally in at least one reply in a short chat exchange.",
  "mode": "chat",
  "character": "blue",
  "turns": [
    {"user": "오늘 소나기 왔어. 빗소리 들었어?"},
    {"user": "응, 창문에 떨어지는 소리가 좋더라."}
  ],
  "expect": {
    "full_session": [
      {"any_reply_contains_any": ["찰랑", "퐁당", "졸졸", "잔잔", "똑똑"]}
    ]
  }
}
```

- [ ] **Step 13.5: Create anchor 4 scenario (honor 싫어)**

```json
{
  "name": "wave2a_anchor_4_honor_rejection",
  "description": "Wave 2A anchor 4: Kid rejects a topic; Dodami pivots immediately and does NOT re-propose the rejected topic in the next turn.",
  "mode": "chat",
  "character": "red",
  "turns": [
    {"user": "수학 놀이 해볼까?"},
    {"user": "아니 수학 싫어."}
  ],
  "expect": {
    "turn_specific": [
      {"turn_index": 1, "reply_excludes_any": ["수학", "계산", "더하기", "빼기"]}
    ]
  }
}
```

- [ ] **Step 13.6: Create anchor 5 scenario (content-delivery)**

```json
{
  "name": "wave2a_anchor_5_content_delivery",
  "description": "Wave 2A anchor 5: Kid asks for a riddle; Dodami's reply contains the actual riddle content, not just 'okay I'll give you one'.",
  "mode": "riddle",
  "character": "blue",
  "turns": [
    {"user": "수수께끼 하나 해줘."}
  ],
  "expect": {
    "turn_specific": [
      {"reply_contains_any": ["뭘까?", "뭐게?", "맞춰봐", "무엇일까?"]}
    ]
  }
}
```

The riddle bank always produces a question-ending; the assertion checks the reply actually has a question mark structure, not just a commit phrase.

- [ ] **Step 13.7: Create anchor 6 scenario (short-answer handling)**

```json
{
  "name": "wave2a_anchor_6_short_answer",
  "description": "Wave 2A anchor 6: Kid replies '몰라'; Dodami's next turn does NOT re-ask the same question, offers specific alternatives instead.",
  "mode": "chat",
  "character": "yellow",
  "turns": [
    {"user": "심심해."},
    {"user": "몰라."}
  ],
  "expect": {
    "turn_specific": [
      {"turn_index": 1, "reply_contains_any": ["할까", "들려줄까", "어떨까", "아니면", "그럼"]}
    ]
  }
}
```

- [ ] **Step 13.8: Create anchor 7 scenario (energy-matching)**

```json
{
  "name": "wave2a_anchor_7_energy_matching",
  "description": "Wave 2A anchor 7: Tired-signal kid gets a calm reply from 반짝이 (matching low energy, not forced high energy).",
  "mode": "chat",
  "character": "yellow",
  "turns": [
    {"user": "오늘 너무 피곤해..."}
  ],
  "expect": {
    "turn_specific": [
      {"reply_excludes_any": ["!!", "!!!", "와!!!", "오오오", "대박", "최고"]}
    ]
  }
}
```

- [ ] **Step 13.9: Create anchor 8 scenario (signature-move)**

```json
{
  "name": "wave2a_anchor_8_signature_move",
  "description": "Wave 2A anchor 8: 바라미's signature notice-detail→connect. Kid shares an observation; 바라미 picks a detail and pivots to a related topic.",
  "mode": "chat",
  "character": "green",
  "turns": [
    {"user": "오늘 나뭇잎이 떨어졌어."},
    {"user": "노란색이었어."}
  ],
  "expect": {
    "full_session": [
      {"any_reply_contains_any": ["색", "어디서", "그러고 보니", "요즘"]}
    ]
  }
}
```

- [ ] **Step 13.10: Check if new assertion handlers are needed**

```bash
grep -n "reply_starts_with_any\|reply_contains_any\|any_reply_contains_any\|reply_excludes_any" bin/pilot-replay.py
```

For any assertion type not already handled, add a handler in `bin/pilot-replay.py`. If ALL are already handled, skip to step 13.11.

Assertion handler sketch (add to bin/pilot-replay.py if needed):

```python
def assert_reply_starts_with_any(_scenario, response, prefixes):
    """First turn's reply must start with one of the listed prefixes."""
    turns = _all_turns(response)
    if not turns:
        return (False, 'no turns in response')
    reply = turns[0].get('reply', '')
    head = reply[:30]
    hit = any(head.startswith(p) for p in (prefixes or []))
    return (hit, '' if hit else f"reply start {head!r} matched none of {prefixes}")


def assert_reply_excludes_any(_scenario, response, forbidden):
    """Reply of first (or specified) turn must not contain any forbidden
    substring. If called with a turn_index in the scenario entry, that
    turn's reply is checked; otherwise all turns."""
    bad = []
    for turn in _all_turns(response):
        reply = turn.get('reply', '')
        for f in (forbidden or []):
            if f in reply:
                bad.append((turn.get('turn_index'), f))
                break
    return (not bad, '' if not bad else f"forbidden patterns found: {bad}")


def assert_any_reply_contains_any(_scenario, response, wanted):
    """Across all turns, at least one reply must contain at least one
    of the wanted substrings."""
    for turn in _all_turns(response):
        reply = turn.get('reply', '')
        for w in (wanted or []):
            if w in reply:
                return (True, '')
    return (False, f"no reply contained any of {wanted}")
```

Register these handlers in the dispatch table alongside the existing assertion types (grep for `assert_no_tier1_block` for the registration pattern).

- [ ] **Step 13.11: Run the 8 scenarios against localhost**

First, need Dodami running locally. If not already running, start it:

```bash
cd /Users/will/nanoclaw/dodami-magic-wave1
# Ensure Ollama + gemma4:31b are running; check /health
python3 realtime_server_v3_gemma.py &
sleep 30  # model load
curl -s http://localhost:8081/health | head -c 200
```

If localhost not feasible, run against 5090:

```bash
DODAMI_ADMIN_KEY=wbHFoOr99cuNnFlashg5OJuUjc2Egfh3 python3 bin/pilot-replay.py \
  --url http://192.168.219.110:8081 \
  --scenarios tests/integration/scenarios \
  --only wave2a_anchor_1_emotion_first,wave2a_anchor_2_askback_no_attribution,wave2a_anchor_3_element_vocab,wave2a_anchor_4_honor_rejection,wave2a_anchor_5_content_delivery,wave2a_anchor_6_short_answer,wave2a_anchor_7_energy_matching,wave2a_anchor_8_signature_move
```

(Note: the 5090 won't have the new Wave 2A cards until deploy. For pre-deploy validation, must run locally. If local Dodami isn't available, defer pilot-replay validation to post-deploy and mark this step as done-with-caveat.)

Expected: 7-8 / 8 pass on first run. LLM non-determinism means rare failures are acceptable; persistent failures mean the scenarios are too strict or the anchor isn't landing.

- [ ] **Step 13.12: Commit scenarios + any assertion-handler changes**

```bash
git add tests/integration/scenarios/wave2a_anchor_*.json
# If bin/pilot-replay.py was modified:
git add bin/pilot-replay.py
git commit -m "wave2a: 8 critical-path pilot-replay scenarios (one per anchor)

Regression guard: ensures anchor behaviors surface in LLM output across
chat/riddle modes and all 4 character selections. Heuristic assertions
(prefix-match / exclude-substring / any-contains) — catch gross regressions,
not nuance. Full 32-scenario set (anchor × character) deferred to 2B
rollout gate per spec."
```

---

## Task 14: Integration verification + PR

**Files:**
- No code changes here; runs the gates + opens the PR.

### Steps

- [ ] **Step 14.1: Run full unit suite — final check**

```bash
DODAMI_TEST_SKIP_LOAD=1 python3 -m pytest tests/ 2>&1 | tail -5
```

Expected: baseline + all Wave 2A tests. Pre-existing 8 failures unchanged.

- [ ] **Step 14.2: Run pilot-replay against 5090 (pre-merge) with full scenario set**

```bash
DODAMI_ADMIN_KEY=wbHFoOr99cuNnFlashg5OJuUjc2Egfh3 python3 bin/pilot-replay.py \
  --url http://192.168.219.110:8081 \
  --scenarios tests/integration/scenarios 2>&1 | tail -20
```

Expected: legacy scenarios still pass (cache_hit, crisis, greeting, etc.). New wave2a scenarios will FAIL here because 5090 doesn't have the new cards yet — this is EXPECTED and informational. Note the wave2a pass/fail counts; they validate post-deploy.

- [ ] **Step 14.3: Codex review — pre-merge**

```bash
codex review --base origin/main 2>&1 | tail -40
```

Expected: clean run. If findings surface, fix in-place and re-run. Target: "did not find an introduced bug that would likely warrant a fix."

- [ ] **Step 14.4: Push the branch**

```bash
git push -u origin feat/magic-wave2a
```

- [ ] **Step 14.5: Open the PR**

```bash
gh pr create --repo flusterff/dodami \
  --base main --head feat/magic-wave2a \
  --title "wave2a: character voice few-shots + 사랑이 → 새싹이 rename" \
  --body "$(cat <<'EOF'
## Summary

Wave 2A of Stream C — show-don't-tell character card rewrite + 사랑이 → 새싹이 rename.

- **4 character cards rewritten** (퐁당이 / 새싹이 / 반짝이 / 바라미): dialogue-first hybrid structure. Identity trimmed to 1-2 sentences; kept onomatopoeia + forbidden patterns; added 8 few-shot dialogues per character (32 total) anchored on specific behaviors.
- **Behavioral anchors**: emotion-first, ask-back-without-attribution (Socratic misfire fix), element-vocab-in-context, honor-rejection, content-delivery-handoff, short-answer-handling, energy-matching, character-signature-move.
- **사랑이 → 새싹이 rename** across persona.py + demo-onboarding.html + tests. Matches Stream C rev-2 spec.
- **Flag-gated** behind `DODAMI_MAGIC_WAVE2A=1` (rollout trigger; cards are active unconditionally once merged — flag is for observability).
- **8 critical-path pilot-replay scenarios** (one per anchor) as regression guard. Heuristic assertions, not LLM-judge.
- **Structural + prosodic tests** in tests/test_character_cards.py: 8-dialogue-count, Dodami-turn IP-ending (종결어미 / 의문형), section presence, character differentiation.

## Test plan

- [x] Full unit suite green: 907 baseline + Wave 2A tests
- [x] Pre-existing 8 failures unchanged
- [x] Codex review clean
- [ ] Deploy to 5090 with flag OFF → no behavior change on existing sessions
- [ ] Deploy + flip flag ON for 테스팅 → Will runs ~3 sessions per character, gut-check 'this is the character'
- [ ] Post-deploy run wave2a_anchor_*.json scenarios against 5090 → ≥7/8 pass stably
- [ ] If clean: 24h canary on 몽실 → fleet-wide

## Spec + plan

- Spec: [`nanoclaw:docs/superpowers/specs/2026-04-23-dodami-magic-wave2a-design.md`](https://github.com/flusterff/nanoclaw/blob/feat/dodami-magic-charter/docs/superpowers/specs/2026-04-23-dodami-magic-wave2a-design.md)
- Plan: [`nanoclaw:docs/superpowers/plans/2026-04-23-dodami-magic-wave2a.md`](https://github.com/flusterff/nanoclaw/blob/feat/dodami-magic-charter/docs/superpowers/plans/2026-04-23-dodami-magic-wave2a.md)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 14.6: Handoff to Will**

Report to Will:
- Branch pushed, PR opened, codex review clean
- Pre-deploy scenario status (legacy pass, wave2a fail pending deploy)
- Ready for merge + deploy + rollout
- Link to deploy gate in AGENTS.md §9

Will reviews PR, merges, deploys via `./deploy.sh server`. Post-deploy gut-check + canary per spec D6.

---

## Self-review

**1. Spec coverage:**
- D1 rename → Task 2 ✓
- D2 dialogue-first hybrid structure → Task 12 ✓
- D3 8 behavioral anchors → Tasks 4-11 (one per anchor) ✓
- D4 dialogue format (2-3 turn, IP-boundary endings) → Tasks 4-11 + test_dodami_turns_end_at_ip_boundary in Task 12 ✓
- D5 anchor-parallel production → Tasks 4-11 structure ✓
- D6 done criteria (manual + scenario) → Tasks 13 + 14 + post-merge gut-check ✓
- Wave 2A flag → Task 1 ✓
- 8 critical-path scenarios → Task 13 ✓
- Unit tests → Tasks 3 + 12 ✓

**2. Placeholder scan:**
- Anchor tasks (4-11) necessarily have structural placeholders for unfilled seed content — flagged as `[DRAFT]` / `[TBD in session]` inside the task bodies. This is the collaborative nature of dialogue drafting, not plan laziness. Each anchor task provides one concrete seed + rubric for the other 3.
- `bin/pilot-replay.py` assertion-handler stubs in Step 13.10 — complete code shown, engineer wires them up.
- No "implement later" / "fill in details" at the code level.

**3. Type consistency:**
- `_SARANGI_CARD` → `_SAESSAKI_CARD` variable rename referenced consistently in Tasks 2 + 12.
- `CHARACTER_CARDS` + `DEFAULT_CHARACTER_NAMES` dicts treated as-is in all tasks.
- `get_persona_prompt(color, name)` signature consistent.
- Scenario JSON fields consistent: `name`, `description`, `mode`, `character`, `turns[].user`, `expect.turn_specific[]`, `expect.full_session[]`.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-dodami-magic-wave2a.md`. Two execution options:

**1. Subagent-Driven (recommended for Tasks 1-3 + 12-14)** — dispatch a fresh subagent (codex:rescue per prior pattern) for code tasks; fresh review between tasks. Tasks 4-11 (anchor drafting) are explicitly collaborative — not subagent-offloadable because Will reviews in-session.

**2. Inline Execution** — execute all tasks in this session. Tasks 1-3 are quick code changes, 12-14 are wire-up + PR. Tasks 4-11 are the expensive collaboration cycles.

**Recommended sequence:**
1. Claude dispatches codex for Tasks 1-3 (branch + rename + scaffold) — ~1 hour total
2. Claude + Will do Tasks 4-11 anchor-parallel (one anchor per collaboration block, ~1-2 hours each) — 3-5 days elapsed
3. Claude dispatches codex for Tasks 12-14 (assembly + scenarios + PR) — ~1 day

Which approach for Tasks 1-3?
