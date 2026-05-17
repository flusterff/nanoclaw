#!/bin/bash
# Post-edit hook: syntax check for .py and .html files
FILE=$(jq -r '.tool_input.file_path' 2>/dev/null)
[ -z "$FILE" ] && exit 0

if echo "$FILE" | grep -qE '\.py$'; then
  if python3 -c "compile(open('$FILE').read(), '$FILE', 'exec')" 2>/dev/null; then
    echo '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"Python syntax OK"}}'
  else
    echo "{\"decision\":\"block\",\"reason\":\"SYNTAX ERROR in $FILE. Fix before continuing.\"}"
  fi
elif echo "$FILE" | grep -qE '\.html$'; then
  python3 -c "
import sys
c = open('$FILE').read()
for t in ['script','style']:
    o = c.lower().count('<'+t)
    cl = c.lower().count('</'+t)
    if o != cl:
        print('{\"decision\":\"block\",\"reason\":\"MISMATCHED <'+t+'> in $FILE ('+str(o)+' open, '+str(cl)+' close)\"}')
        sys.exit(0)
print('{\"hookSpecificOutput\":{\"hookEventName\":\"PostToolUse\",\"additionalContext\":\"HTML tags OK\"}}')
" 2>/dev/null
else
  echo '{}'
fi
