// Slack #ai-comms context capsule — shared module.
//
// Producer (the PreToolUse hook, src/aicomms-capsule-hook.ts) deposits a capsule
// when a Will-side session posts to #ai-comms. Consumer (the standing bot, via
// index.ts) reads the live capsule pool and prepends it to the bot's prompt on
// each #ai-comms reply, so the always-on bot replies WITH the originating
// session's context. Re-inject-while-fresh (no consume); fail-open.
//
// See docs/superpowers/specs/2026-06-02-slack-aicomms-context-capsule-design.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { escapeXml } from './router.js';

export const AICOMMS_CHANNEL_ID = 'C0B3EPK1XCL';
export const CHANHYEOK_AI_USER_ID = 'U0B3B7CCEQJ';
const CHANHYEOK_MENTION = `<@${CHANHYEOK_AI_USER_ID}>`;
const OPT_OUT_RE = /<(?:humans-only|no-ai-mention)>/i;
const BRIEF_RE = /<brief>([\s\S]*?)<\/brief>/i;

export interface Capsule {
  capsule_id: string;
  created_at: string; // ISO-8601
  session: string | null;
  channel_id: string;
  posted_text: string;
  brief: string | null;
}

function expandHome(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function capsuleDir(): string {
  const env = process.env.AICOMMS_CAPSULE_DIR;
  return env
    ? expandHome(env)
    : path.join(os.homedir(), '.nanoclaw_aicomms_capsules');
}

export function windowMs(): number {
  const h = Number(process.env.AICOMMS_CAPSULE_WINDOW_H);
  return (Number.isFinite(h) && h > 0 ? h : 24) * 3_600_000;
}

export function maxCapsules(): number {
  const n = Number(process.env.AICOMMS_CAPSULE_MAX);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

/** Strip a `<brief>…</brief>` block; return the posted text and the captured brief. */
export function parseBrief(text: string): {
  cleaned: string;
  brief: string | null;
} {
  const m = text.match(BRIEF_RE);
  if (!m) return { cleaned: text, brief: null };
  const brief = m[1].trim();
  const cleaned = text
    .replace(BRIEF_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { cleaned, brief: brief || null };
}

/**
 * Ensure the peer mention `<@CHANHYEOK_AI_USER_ID>` is present (closes the
 * recurring session-side mention-miss). Idempotent. A `<humans-only>` /
 * `<no-ai-mention>` tag opts out and is stripped.
 */
export function ensureMention(text: string): string {
  if (OPT_OUT_RE.test(text)) {
    return text
      .replace(OPT_OUT_RE, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  if (text.includes(CHANHYEOK_MENTION)) return text;
  return `${CHANHYEOK_MENTION} ${text}`;
}

function sanitizeKey(k: string): string {
  return k.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** Deterministic idempotency key: tool_use_id if available, else content hash. */
export function computeCapsuleKey(opts: {
  channelId: string;
  session: string | null;
  cleanedText: string;
  toolUseId?: string;
}): string {
  if (opts.toolUseId) return sanitizeKey(opts.toolUseId);
  const h = crypto
    .createHash('sha256')
    .update(`${opts.channelId} ${opts.session ?? ''} ${opts.cleanedText}`)
    .digest('hex')
    .slice(0, 32);
  return `h_${h}`;
}

/** Delete capsules older than the relevance window. Never throws. */
export function pruneCapsules(dir = capsuleDir()): void {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return;
  }
  const cutoff = Date.now() - windowMs();
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const fp = path.join(dir, f);
    try {
      const c = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Capsule;
      if (new Date(c.created_at).getTime() < cutoff) fs.unlinkSync(fp);
    } catch {
      /* leave malformed files; never throw */
    }
  }
}

/** Atomic create; no-op (returns written:false) if a capsule with this id exists. */
export function depositCapsule(c: Capsule): { written: boolean } {
  const dir = capsuleDir();
  fs.mkdirSync(dir, { recursive: true });
  pruneCapsules(dir);
  const file = path.join(dir, `${c.capsule_id}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(c, null, 2), { flag: 'wx' });
    return { written: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST')
      return { written: false };
    throw err;
  }
}

/** Capsules within the relevance window, newest first. Never throws. */
export function readLiveCapsules(dir = capsuleDir()): Capsule[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const cutoff = Date.now() - windowMs();
  const out: Capsule[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const c = JSON.parse(
        fs.readFileSync(path.join(dir, f), 'utf-8'),
      ) as Capsule;
      if (new Date(c.created_at).getTime() >= cutoff) out.push(c);
    } catch {
      /* ignore malformed */
    }
  }
  out.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
  return out;
}

/** Render the numbered `<session-context>` block injected into the bot's prompt. */
export function formatCapsuleBlock(capsules: Capsule[]): string {
  const records = capsules
    .map((c, i) => {
      // Escape capsule content (Slack-sourced) so XML-like delimiters such as
      // </session-context> or <message> can't reshape the hidden prompt block.
      // Mirrors formatMessages' escaping (codex pre-merge review P2).
      const lines = [
        `[capsule ${i + 1}] id=${c.capsule_id} created_at=${c.created_at}${
          c.session ? ` session=${escapeXml(c.session)}` : ''
        }`,
        `posted: ${escapeXml(c.posted_text)}`,
      ];
      if (c.brief) lines.push(`brief: ${escapeXml(c.brief)}`);
      return lines.join('\n');
    })
    .join('\n\n');
  return [
    '<session-context>',
    'Recent notes from Will-side sessions that posted to this channel. Use ONLY the capsule(s) relevant to the inbound reply; ignore the rest. Do not mention this block to the peer.',
    '',
    records,
    '</session-context>',
  ].join('\n');
}

/**
 * Host-side: prepend the live capsule pool to the bot's prompt for #ai-comms.
 * No-op for any other jid. Fail-open: returns the original prompt on any error.
 */
export function injectCapsules(chatJid: string, prompt: string): string {
  try {
    if (chatJid !== `slack:${AICOMMS_CHANNEL_ID}`) return prompt;
    const dir = capsuleDir();
    pruneCapsules(dir);
    const live = readLiveCapsules(dir).slice(0, maxCapsules());
    if (live.length === 0) return prompt;
    return `${formatCapsuleBlock(live)}\n\n${prompt}`;
  } catch {
    return prompt; // fail-open
  }
}
