import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHookResult } from './aicomms-capsule-hook.js';
import { CHANHYEOK_AI_USER_ID, readLiveCapsules } from './aicomms-capsule.js';

const M = `<@${CHANHYEOK_AI_USER_ID}>`;
const AICOMMS = 'C0B3EPK1XCL';

describe('buildHookResult', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-'));
    process.env.AICOMMS_CAPSULE_DIR = tmp;
    delete process.env.AICOMMS_CAPSULE_WINDOW_H;
    delete process.env.CLAUDE_SESSION_COLOR;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.AICOMMS_CAPSULE_DIR;
  });

  it('no-ops (no result, no capsule) for a non-ai-comms channel', () => {
    const r = buildHookResult({
      tool_use_id: 't1',
      tool_input: { channel_id: 'COTHER', text: 'hi' },
    });
    expect(r).toBeNull();
    expect(readLiveCapsules().length).toBe(0);
  });

  it('injects mention, strips <brief>, deposits capsule, returns updatedInput', () => {
    const r = buildHookResult({
      tool_use_id: 't2',
      tool_input: { channel_id: AICOMMS, text: 'pushed\n<brief>why</brief>' },
    });
    expect(r?.hookSpecificOutput.updatedInput.text).toBe(`${M} pushed`);
    const caps = readLiveCapsules();
    expect(caps.length).toBe(1);
    expect(caps[0].brief).toBe('why');
    expect(caps[0].posted_text).toBe(`${M} pushed`);
  });

  it('is idempotent on duplicate tool_use_id (single capsule)', () => {
    buildHookResult({
      tool_use_id: 'dup',
      tool_input: { channel_id: AICOMMS, text: 'x' },
    });
    buildHookResult({
      tool_use_id: 'dup',
      tool_input: { channel_id: AICOMMS, text: 'x' },
    });
    expect(readLiveCapsules().length).toBe(1);
  });

  it('returns null (no rewrite) when the exact mention is already present, but still deposits', () => {
    const r = buildHookResult({
      tool_use_id: 't3',
      tool_input: { channel_id: AICOMMS, text: `${M} ok` },
    });
    expect(r).toBeNull();
    expect(readLiveCapsules().length).toBe(1);
  });

  it('preserves other tool_input fields in updatedInput', () => {
    const r = buildHookResult({
      tool_use_id: 't4',
      tool_input: { channel_id: AICOMMS, text: 'hi', thread_ts: '123.456' },
    });
    expect(r?.hookSpecificOutput.updatedInput.channel_id).toBe(AICOMMS);
    expect(r?.hookSpecificOutput.updatedInput.thread_ts).toBe('123.456');
  });
});
