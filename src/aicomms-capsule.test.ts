import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  AICOMMS_CHANNEL_ID,
  CHANHYEOK_AI_USER_ID,
  computeCapsuleKey,
  depositCapsule,
  ensureMention,
  injectCapsules,
  parseBrief,
  readLiveCapsules,
  type Capsule,
} from './aicomms-capsule.js';

const M = `<@${CHANHYEOK_AI_USER_ID}>`;

describe('parseBrief', () => {
  it('strips <brief> and returns its content', () => {
    const r = parseBrief(
      'Pushed scoresheet.\n<brief>why: needs review by EOD</brief>',
    );
    expect(r.brief).toBe('why: needs review by EOD');
    expect(r.cleaned).toBe('Pushed scoresheet.');
  });
  it('returns null brief when absent', () => {
    expect(parseBrief('plain text').brief).toBeNull();
    expect(parseBrief('plain text').cleaned).toBe('plain text');
  });
});

describe('ensureMention', () => {
  it('prepends the peer mention when absent', () => {
    expect(ensureMention('review pls')).toBe(`${M} review pls`);
  });
  it('is idempotent when the exact mention is present', () => {
    expect(ensureMention(`${M} review pls`)).toBe(`${M} review pls`);
  });
  it('does NOT inject when humans-only opt-out is present, and strips the tag', () => {
    expect(ensureMention('<humans-only>note for Will')).toBe('note for Will');
  });
  it('still injects when a DIFFERENT user is mentioned but not the peer', () => {
    expect(ensureMention('<@U0B392CRVKQ> fyi')).toBe(`${M} <@U0B392CRVKQ> fyi`);
  });
});

describe('computeCapsuleKey', () => {
  it('uses tool_use_id when present (sanitized)', () => {
    expect(
      computeCapsuleKey({
        channelId: 'C',
        session: null,
        cleanedText: 'x',
        toolUseId: 'toolu_01ABC',
      }),
    ).toBe('toolu_01ABC');
  });
  it('is deterministic from content when no tool_use_id', () => {
    const a = computeCapsuleKey({
      channelId: 'C',
      session: 'green',
      cleanedText: 'x',
    });
    const b = computeCapsuleKey({
      channelId: 'C',
      session: 'green',
      cleanedText: 'x',
    });
    expect(a).toBe(b);
    expect(a).not.toBe(
      computeCapsuleKey({ channelId: 'C', session: 'green', cleanedText: 'y' }),
    );
  });
});

describe('capsule store', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capsule-'));
    process.env.AICOMMS_CAPSULE_DIR = tmp;
    delete process.env.AICOMMS_CAPSULE_WINDOW_H;
    delete process.env.AICOMMS_CAPSULE_MAX;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.AICOMMS_CAPSULE_DIR;
    delete process.env.AICOMMS_CAPSULE_WINDOW_H;
    delete process.env.AICOMMS_CAPSULE_MAX;
  });

  const mk = (over: Partial<Capsule> = {}): Capsule => ({
    capsule_id: 'k1',
    created_at: new Date().toISOString(),
    session: 'green',
    channel_id: AICOMMS_CHANNEL_ID,
    posted_text: 'pushed X',
    brief: null,
    ...over,
  });
  const jid = `slack:${AICOMMS_CHANNEL_ID}`;

  it('writes a capsule then no-ops on duplicate key', () => {
    expect(depositCapsule(mk()).written).toBe(true);
    expect(depositCapsule(mk({ posted_text: 'different' })).written).toBe(
      false,
    );
    expect(readLiveCapsules().length).toBe(1);
  });

  it('injectCapsules returns prompt unchanged for non-ai-comms jids', () => {
    depositCapsule(mk());
    expect(injectCapsules('slack:COTHER', 'PROMPT')).toBe('PROMPT');
  });

  it('prepends a numbered <session-context> block, newest first', () => {
    depositCapsule(
      mk({
        capsule_id: 'a',
        posted_text: 'older',
        created_at: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    depositCapsule(mk({ capsule_id: 'b', posted_text: 'newer' }));
    const out = injectCapsules(jid, 'PROMPT');
    expect(out).toContain('<session-context>');
    expect(out).toContain('newer');
    expect(out).toContain('older');
    expect(out.indexOf('newer')).toBeLessThan(out.indexOf('older'));
    expect(out.trimEnd().endsWith('PROMPT')).toBe(true);
  });

  it('returns prompt unchanged when no live capsules', () => {
    expect(injectCapsules(jid, 'PROMPT')).toBe('PROMPT');
  });

  it('prunes + ignores capsules older than the window', () => {
    process.env.AICOMMS_CAPSULE_WINDOW_H = '1';
    depositCapsule(
      mk({
        capsule_id: 'stale',
        created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      }),
    );
    expect(injectCapsules(jid, 'PROMPT')).toBe('PROMPT');
    expect(fs.existsSync(path.join(tmp, 'stale.json'))).toBe(false);
  });

  it('caps at AICOMMS_CAPSULE_MAX newest', () => {
    process.env.AICOMMS_CAPSULE_MAX = '2';
    for (let i = 0; i < 4; i++) {
      depositCapsule(
        mk({
          capsule_id: `c${i}`,
          created_at: new Date(Date.now() - i * 1000).toISOString(),
          posted_text: `p${i}`,
        }),
      );
    }
    const out = injectCapsules(jid, 'PROMPT');
    expect(out).toContain('p0');
    expect(out).toContain('p1');
    expect(out).not.toContain('p3');
  });

  it('fails open (returns prompt) if the store dir is unreadable', () => {
    process.env.AICOMMS_CAPSULE_DIR = '/dev/null/nope';
    expect(injectCapsules(jid, 'PROMPT')).toBe('PROMPT');
  });
});
