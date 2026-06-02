// PreToolUse hook: intercepts a session's mcp__slack__conversations_add_message
// to #ai-comms. Deposits a context capsule + enforces the <@Chanhyeok> mention,
// then allows the (possibly rewritten) call. Fail-open: any error → allow unchanged.
//
// Wired in ~/.claude/settings.json as:
//   { "matcher": "mcp__slack__conversations_add_message",
//     "hooks": [{ "type": "command", "command": "node /Users/will/nanoclaw/dist/aicomms-capsule-hook.js" }] }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AICOMMS_CHANNEL_ID,
  computeCapsuleKey,
  depositCapsule,
  ensureMention,
  parseBrief,
} from './aicomms-capsule.js';

export interface HookInput {
  tool_use_id?: string;
  tool_input?: { channel_id?: string; text?: string; [k: string]: unknown };
}

export interface HookResult {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse';
    permissionDecision: 'allow';
    updatedInput: Record<string, unknown>;
  };
}

function sessionColor(): string | null {
  if (process.env.CLAUDE_SESSION_COLOR) return process.env.CLAUDE_SESSION_COLOR;
  try {
    const v = fs
      .readFileSync(
        path.join(process.cwd(), '.claude', 'session-color'),
        'utf-8',
      )
      .trim();
    return v || null;
  } catch {
    return null;
  }
}

/**
 * Deposit the capsule (side effect) and return the input-rewrite result, or null
 * when the channel isn't #ai-comms / there's nothing to rewrite. Exported for tests.
 */
export function buildHookResult(input: HookInput): HookResult | null {
  const ti = input.tool_input ?? {};
  const channelId = ti.channel_id;
  const rawText = typeof ti.text === 'string' ? ti.text : undefined;
  if (channelId !== AICOMMS_CHANNEL_ID || rawText === undefined) return null;

  const { cleaned, brief } = parseBrief(rawText);
  const finalText = ensureMention(cleaned);
  const session = sessionColor();
  const capsule_id = computeCapsuleKey({
    channelId,
    session,
    cleanedText: finalText,
    toolUseId: input.tool_use_id,
  });
  depositCapsule({
    capsule_id,
    created_at: new Date().toISOString(),
    session,
    channel_id: channelId,
    posted_text: finalText,
    brief,
  });

  if (finalText === rawText) return null; // nothing to rewrite
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput: { ...ti, text: finalText },
    },
  };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main(): Promise<void> {
  let input: HookInput | undefined;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.exit(0); // fail-open: allow unchanged
  }
  try {
    const result = buildHookResult(input!);
    if (result) process.stdout.write(JSON.stringify(result));
  } catch {
    /* fail-open */
  }
  process.exit(0);
}

// Run main() only when executed directly (not when imported by tests).
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  void main();
}
