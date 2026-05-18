## RULES flow (strict read-only — HARD GATE)

Purpose: surface repeated failure / friction / decision patterns from recent handoffs and print candidate CLAUDE.md rule additions. RULES never auto-writes to CLAUDE.md, project CLAUDE.md, MEMORY.md, SYNC.md, handoff files, or any rule file. The user manually copies any accepted draft.

V1 intentionally uses keyword counting only. Do not use embeddings, Levenshtein distance, ML clustering, or scans outside the handoff directory.

### Step 1: Collect handoff candidates

Scan only `~/.claude/projects/-Users-will-nanoclaw/memory/handoff_*.md`. Default window is the last 30 handoffs by file mtime. `--last=<N>` overrides the window.

```bash
HANDOFF_DIR=~/.claude/projects/-Users-will-nanoclaw/memory
: "${RULES_LAST:=30}"

case "$RULES_LAST" in
  ''|*[!0-9]*)
    echo "ERROR: --last must be a positive integer"
    exit 2
    ;;
esac
if [ "$RULES_LAST" -le 0 ]; then
  echo "ERROR: --last must be a positive integer"
  exit 2
fi

ALL_HANDOFFS=$(find "$HANDOFF_DIR" -maxdepth 1 -name "handoff_*.md" -type f -print 2>/dev/null)
if printf '%s\n' "$ALL_HANDOFFS" | grep -q .; then
  CANDIDATES=$(printf '%s\n' "$ALL_HANDOFFS" | xargs ls -t 2>/dev/null | head -n "$RULES_LAST")
else
  CANDIDATES=""
fi
SCAN_COUNT=$(printf '%s\n' "$CANDIDATES" | grep -c . || true)
```

Do not apply a repo+branch filter by default; durable rules are user-workflow signals across recent handoffs. A future version may add an explicit filter, but V1 scans the recent handoff window as-is.

### Step 2: Extract candidate items per handoff

Extract exactly three signal types:

1. `drop`: body `### Open Loops` → `**Drop / Did Not Do:**`
2. `blocked_waiting`: body `### Open Loops` → `**Blocked:**` and `**Waiting:**`
3. `do_not_do`: frontmatter `do_not_do:` list

Use grep/sed/shell parsing only. Do not use awk positional fields or shell positional dollar-number args; the Skill renderer can clobber those before Bash sees them.

```bash
STOPWORDS='^(the|and|for|with|from|into|that|this|then|than|only|also|because|before|after|until|next|step|work|working|session|handoff|rule|rules|claude|codex|will|read|write|file|files|line|lines|drop|did|not|done|blocked|waiting|scope|user|repo|branch)$'

keyword_key() {
  text="$KEYWORD_TEXT"
  keywords=$(
    printf '%s\n' "$text" \
      | tr '[:upper:]' '[:lower:]' \
      | tr -cs '[:alnum:]_./#:-' '\n' \
      | grep -E '.{3,}' \
      | grep -Eiv "$STOPWORDS" \
      | sort -u \
      | head -5
  )
  keyword_count=$(printf '%s\n' "$keywords" | grep -c . || true)
  [ "$keyword_count" -ge 3 ] || return 0
  printf '%s\n' "$keywords" | paste -sd' ' -
}

emit_signal_item() {
  signal="$EMIT_SIGNAL"
  handoff_id="$EMIT_HANDOFF_ID"
  item="$EMIT_ITEM"
  cleaned=$(printf '%s\n' "$item" | tr '|' '/' | sed -E 's/^[[:space:]>*-]+//; s/[[:space:]]+$//')
  [ -n "$cleaned" ] || return 0
  key=$(KEYWORD_TEXT="$cleaned" keyword_key)
  [ -n "$key" ] || return 0
  printf '%s|%s|%s|%s\n' "$signal" "$key" "$handoff_id" "$cleaned"
}

extract_open_loop_label() {
  file="$EXTRACT_FILE"
  wanted="$EXTRACT_LABEL"
  in_open=false
  in_label=false

  while IFS= read -r line; do
    case "$line" in
      "### Open Loops")
        in_open=true
        in_label=false
        continue
        ;;
      "### "*)
        if [ "$in_open" = true ]; then
          break
        fi
        ;;
    esac

    [ "$in_open" = true ] || continue

    case "$line" in
      "**Waiting:**"*)
        [ "$wanted" = waiting ] && in_label=true || in_label=false
        continue
        ;;
      "**Blocked:**"*)
        [ "$wanted" = blocked ] && in_label=true || in_label=false
        continue
        ;;
      "**Drop / Did Not Do:**"*)
        [ "$wanted" = drop ] && in_label=true || in_label=false
        continue
        ;;
      "**"*)
        in_label=false
        continue
        ;;
    esac

    [ "$in_label" = true ] || continue
    printf '%s\n' "$line" \
      | grep -E '^[[:space:]]*[-*] |^[[:space:]]*[0-9]+[.)] ' \
      | sed -E 's/^[[:space:]]*[-*][[:space:]]+//; s/^[[:space:]]*[0-9]+[.)][[:space:]]+//'
  done < "$file"
}

SIGNAL_ROWS=$(
  for f in $CANDIDATES; do
    H_ID=$(sed -n 's/^  handoff_id: //p' "$f" | head -1)
    [ -n "$H_ID" ] || H_ID=$(basename "$f" .md | sed 's/^handoff_//')

    sed -n '/^  do_not_do:/,/^  [A-Za-z_][A-Za-z0-9_]*:/p' "$f" \
      | grep '^    - ' \
      | sed 's/^    - //; s/^"//; s/"$//' \
      | while IFS= read -r item; do
          EMIT_SIGNAL=do_not_do EMIT_HANDOFF_ID="$H_ID" EMIT_ITEM="$item" emit_signal_item
        done

    EXTRACT_FILE="$f" EXTRACT_LABEL=waiting extract_open_loop_label \
      | while IFS= read -r item; do
          EMIT_SIGNAL=blocked_waiting EMIT_HANDOFF_ID="$H_ID" EMIT_ITEM="$item" emit_signal_item
        done

    EXTRACT_FILE="$f" EXTRACT_LABEL=blocked extract_open_loop_label \
      | while IFS= read -r item; do
          EMIT_SIGNAL=blocked_waiting EMIT_HANDOFF_ID="$H_ID" EMIT_ITEM="$item" emit_signal_item
        done

    EXTRACT_FILE="$f" EXTRACT_LABEL=drop extract_open_loop_label \
      | while IFS= read -r item; do
          EMIT_SIGNAL=drop EMIT_HANDOFF_ID="$H_ID" EMIT_ITEM="$item" emit_signal_item
        done
  done
)
```

### Step 3: Count keyword occurrences across handoffs

A pattern qualifies only when the same `signal + keyword_key` appears in at least 3 distinct handoffs. Do not propose a hard rule from one handoff, even if it repeats several times inside that handoff.

```bash
PATTERN_ROWS=$(
  printf '%s\n' "$SIGNAL_ROWS" \
    | while IFS='|' read -r signal key handoff_id item; do
        [ -n "$signal" ] || continue
        printf '%s|%s\n' "$signal" "$key"
      done \
    | sort \
    | uniq -c \
    | sort -rn \
    | while read -r occurrence_count pattern; do
        signal=$(printf '%s\n' "$pattern" | cut -d'|' -f1)
        key=$(printf '%s\n' "$pattern" | cut -d'|' -f2-)

        evidence_ids=$(
          printf '%s\n' "$SIGNAL_ROWS" \
            | while IFS='|' read -r row_signal row_key row_id row_item; do
                if [ "$row_signal" = "$signal" ] && [ "$row_key" = "$key" ]; then
                  printf '%s\n' "$row_id"
                fi
              done \
            | sort -u
        )
        evidence_count=$(printf '%s\n' "$evidence_ids" | grep -c . || true)
        [ "$evidence_count" -ge 3 ] || continue

        evidence_csv=$(printf '%s\n' "$evidence_ids" | head -5 | paste -sd', ' -)
        printf '%s|%s|%s|%s\n' "$occurrence_count" "$signal" "$key" "$evidence_csv"
      done
)
```

### Step 4: Render proposals

Print a proposal block only. Each proposal includes pattern summary, evidence handoff IDs, and draft CLAUDE.md HARD RULE text. Keep drafts short enough for manual copy/paste.

```bash
PROPOSAL_COUNT=$(printf '%s\n' "$PATTERN_ROWS" | grep -c . || true)

if [ "$PROPOSAL_COUNT" -gt 0 ]; then
  printf 'Durable-rule candidates from %s handoffs scanned\n\n' "$SCAN_COUNT"

  proposal_n=0
  printf '%s\n' "$PATTERN_ROWS" \
    | while IFS='|' read -r occurrence_count signal key evidence_csv; do
        [ -n "$signal" ] || continue
        proposal_n=$((proposal_n + 1))

        case "$signal" in
          drop)
            signal_label="Drop / Did Not Do"
            draft_title="Scope reduction: ${key}"
            why_text="The same scope-reduction class appeared in 3 or more handoffs."
            how_text="Before accepting similar work, check whether this scope class should be explicitly out of scope, deferred, or routed to a separate task."
            ;;
          blocked_waiting)
            signal_label="Blocked / Waiting"
            draft_title="Workflow blocker: ${key}"
            why_text="The same blocker class appeared in 3 or more handoffs."
            how_text="At task start, identify whether this blocker class is present; either clear it, name it in the pre-flight, or stop before implementation work depends on it."
            ;;
          do_not_do)
            signal_label="Do not do"
            draft_title="Do not do: ${key}"
            why_text="The same do-not-do guidance appeared in 3 or more handoffs."
            how_text="Treat this as a hard exclusion unless the user explicitly overrides it in the current turn; if overridden, record the waiver and scope."
            ;;
          *)
            signal_label="$signal"
            draft_title="Repeated handoff pattern: ${key}"
            why_text="The same handoff pattern appeared in 3 or more handoffs."
            how_text="Check for this pattern before starting similar work and make the decision explicit."
            ;;
        esac

        printf '%s. Pattern: %s keywords `%s` (%s occurrences)\n' "$proposal_n" "$signal_label" "$key" "$occurrence_count"
        printf '   Evidence: %s\n' "$evidence_csv"
        printf '   Draft CLAUDE.md rule:\n'
        printf '   **%s — HARD RULE**\n' "$draft_title"
        printf '   Why: %s\n' "$why_text"
        printf '   How to apply: %s\n\n' "$how_text"
      done
fi
```

### Step 5: Empty-result fallback

If there are no qualifying patterns, print exactly:

```bash
if [ "$PROPOSAL_COUNT" -eq 0 ]; then
  printf 'No durable-rule candidates surfaced from %s handoffs scanned. Need ≥3 recurring patterns to propose a rule.\n' "$SCAN_COUNT"
fi
```

Then exit. Do not ask AskUserQuestion and do not write any file.

---
