#!/bin/bash
# Post-edit hook: syntax check for .py and .html files.
# Reads Claude Code's JSON payload on stdin, extracts tool_input.file_path,
# and runs a syntax check. Returns {"decision":"block",...} on failure.
#
# Path safety: passes the file path to Python via argv (sys.argv[1]) rather
# than string-interpolating $FILE into Python source — otherwise filenames
# with single quotes (e.g. `kid's_note.py`) break the python -c invocation
# and a valid file appears as a syntax error.

FILE=$(jq -r '.tool_input.file_path' 2>/dev/null)
[ -z "$FILE" ] && exit 0

if echo "$FILE" | grep -qE '\.py$'; then
  if python3 -c "import sys; compile(open(sys.argv[1]).read(), sys.argv[1], 'exec')" "$FILE" 2>/dev/null; then
    echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Python syntax OK"}}'
  else
    # JSON-safe escape of the file path so the reason field stays valid JSON.
    REASON_JSON=$(python3 -c "import sys, json; print(json.dumps('SYNTAX ERROR in ' + sys.argv[1] + '. Fix before continuing.'))" "$FILE")
    echo "{\"decision\":\"block\",\"reason\":$REASON_JSON}"
  fi
elif echo "$FILE" | grep -qE '\.html$'; then
  python3 - "$FILE" <<'PY' 2>/dev/null
import sys, json
path = sys.argv[1]
try:
    c = open(path).read()
except Exception as e:
    print(json.dumps({"decision":"block","reason":f"READ ERROR for {path}: {e}"}))
    sys.exit(0)
for t in ('script', 'style'):
    o = c.lower().count('<' + t)
    cl = c.lower().count('</' + t)
    if o != cl:
        msg = f"MISMATCHED <{t}> in {path} ({o} open, {cl} close)"
        print(json.dumps({"decision":"block","reason":msg}))
        sys.exit(0)
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"HTML tags OK"}}))
PY
else
  echo '{}'
fi
