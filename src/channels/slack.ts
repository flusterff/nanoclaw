import { App, LogLevel } from '@slack/bolt';
import type { GenericMessageEvent, BotMessageEvent } from '@slack/types';
import { appendFile } from 'node:fs/promises';

import { ASSISTANT_NAME, TRIGGER_PATTERN } from '../config.js';
import { updateChatName } from '../db.js';
import { readEnvFile } from '../env.js';
import { logger } from '../logger.js';
import { registerChannel, ChannelOpts } from './registry.js';
import {
  Channel,
  OnInboundMessage,
  OnChatMetadata,
  RegisteredGroup,
} from '../types.js';

// Slack's chat.postMessage API limits text to ~4000 characters per call.
// Messages exceeding this are split into sequential chunks.
const MAX_MESSAGE_LENGTH = 4000;
const OUTGOING_QUEUE_RETRY_BASE_MS = 1000;
const OUTGOING_QUEUE_RETRY_MAX_MS = 30000;

interface SlackEventLogEntry {
  eventTs: string;
  channel: string;
  userId: string;
  threadTs: string;
  text: string;
}

interface OutgoingQueueItem {
  jid: string;
  chunks: string[];
  retryAttempt: number;
}

interface ChunkedPostFailure {
  err: unknown;
  remainingChunks: string[];
  retryAfterMs: number | undefined;
}

function formatSlackEventLogLine(entry: SlackEventLogEntry): string {
  // Schema (mutually-agreed with Chanhyeok-AI standalone listener, 2026-05-14):
  //   event_ts \t channel \t user_id \t thread_ts \t text(JSON.stringify)
  // text is JSON.stringify-escaped so embedded tabs/newlines/quotes don't break
  // the line discipline. Fields 1-4 are simple identifiers (no escaping needed).
  return [
    entry.eventTs,
    entry.channel,
    entry.userId,
    entry.threadTs,
    JSON.stringify(entry.text ?? ''),
  ]
    .join('\t')
    .concat('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readHeader(headers: unknown, name: string): unknown {
  if (!isRecord(headers)) return undefined;

  const maybeGet = headers.get;
  if (typeof maybeGet === 'function') {
    return (
      maybeGet.call(headers, name) ?? maybeGet.call(headers, name.toLowerCase())
    );
  }

  return headers[name] ?? headers[name.toLowerCase()];
}

function retryAfterMsFromError(err: unknown): number | undefined {
  if (!isRecord(err)) return undefined;

  const data = isRecord(err.data) ? err.data : undefined;
  const response = isRecord(err.response) ? err.response : undefined;
  const value =
    err.retryAfter ??
    err.retry_after ??
    data?.retry_after ??
    readHeader(err.headers, 'Retry-After') ??
    readHeader(response?.headers, 'Retry-After');

  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value * 1000;
  }
  if (typeof value !== 'string') return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) return Math.max(0, retryAt - Date.now());
  return undefined;
}

/**
 * Parse `SLACK_PEER_MENTIONS` into a per-channel peer user-ID map.
 *
 * Format: comma-separated `channelId:peerUserId` tuples. Whitespace around
 * tuples and each side of the colon is tolerated. Malformed tuples are
 * skipped with a warning rather than aborting startup.
 *
 * Example: `SLACK_PEER_MENTIONS=C0B3EPK1XCL:U0B3B7CCEQJ,C99999:U88888`
 */
function parsePeerMentions(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;

  for (const tuple of raw.split(',')) {
    const trimmed = tuple.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) {
      logger.warn(
        { tuple: trimmed },
        'SLACK_PEER_MENTIONS tuple missing colon',
      );
      continue;
    }
    const channelId = trimmed.slice(0, colonIdx).trim();
    const peerUserId = trimmed.slice(colonIdx + 1).trim();
    if (!channelId || !peerUserId) {
      logger.warn(
        { tuple: trimmed },
        'SLACK_PEER_MENTIONS tuple has empty channel or peer',
      );
      continue;
    }
    map.set(channelId, peerUserId);
  }

  return map;
}

// The message subtypes we process. Bolt delivers all subtypes via app.event('message');
// we filter to regular messages (GenericMessageEvent, subtype undefined) and bot messages
// (BotMessageEvent, subtype 'bot_message') so we can track our own output.
type HandledMessageEvent = GenericMessageEvent | BotMessageEvent;

export interface SlackChannelOpts {
  onMessage: OnInboundMessage;
  onChatMetadata: OnChatMetadata;
  registeredGroups: () => Record<string, RegisteredGroup>;
}

export class SlackChannel implements Channel {
  name = 'slack';

  private app: App;
  private botUserId: string | undefined;
  private botUserName: string | undefined;
  private botDisplayName: string | undefined;
  private botId: string | undefined;
  private connected = false;
  private outgoingQueue: OutgoingQueueItem[] = [];
  private flushing = false;
  private queueRetryTimer: ReturnType<typeof setTimeout> | undefined;
  private userNameCache = new Map<string, string>();
  private channelPeers: Map<string, string>;
  private eventLogPath: string | undefined;
  private eventLogDisabled = false;

  private opts: SlackChannelOpts;

  constructor(opts: SlackChannelOpts) {
    this.opts = opts;

    // Read tokens from .env (not process.env — keeps secrets off the environment
    // so they don't leak to child processes, matching NanoClaw's security pattern)
    const env = readEnvFile([
      'SLACK_BOT_TOKEN',
      'SLACK_APP_TOKEN',
      'SLACK_PEER_MENTIONS',
      'SLACK_EVENT_LOG_PATH',
    ]);
    const botToken = env.SLACK_BOT_TOKEN;
    const appToken = env.SLACK_APP_TOKEN;
    this.channelPeers = parsePeerMentions(env.SLACK_PEER_MENTIONS);
    this.eventLogPath = env.SLACK_EVENT_LOG_PATH || undefined;

    if (!botToken || !appToken) {
      throw new Error(
        'SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set in .env',
      );
    }

    this.app = new App({
      token: botToken,
      appToken,
      socketMode: true,
      logLevel: LogLevel.ERROR,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Use app.event('message') instead of app.message() to capture all
    // message subtypes including bot_message (needed to track our own output)
    this.app.event('message', async ({ event }) => {
      // Bolt's event type is the full MessageEvent union (17+ subtypes).
      // We filter on subtype first, then narrow to the two types we handle.
      const subtype = (event as { subtype?: string }).subtype;
      if (subtype && subtype !== 'bot_message') return;

      // After filtering, event is either GenericMessageEvent or BotMessageEvent
      const msg = event as HandledMessageEvent;

      if (!msg.text) return;

      // Threaded replies are flattened into the channel conversation.
      // The agent sees them alongside channel-level messages; responses
      // always go to the channel, not back into the thread.

      const jid = `slack:${msg.channel}`;
      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
      const isGroup = msg.channel_type !== 'im';

      // Always report metadata for group discovery
      this.opts.onChatMetadata(jid, timestamp, undefined, 'slack', isGroup);

      // Only deliver full messages for registered groups
      const groups = this.opts.registeredGroups();
      if (!groups[jid]) return;

      // is_from_me: only true when the message originated from THIS bot.
      // is_bot_message: true when message came from any bot (self or external,
      // e.g., another AI-to-AI peer like Chanhyeok-AI). Separating these lets
      // external-bot mentions trigger the agent while still guarding against
      // self-loops.
      //
      // Slack `bot_message` events sometimes carry `bot_id` without a `user`
      // field (e.g., legacy webhook-style posts), so we match self by EITHER
      // user_id OR bot_id to keep the self-loop guard tight.
      const isFromSelf =
        (this.botUserId !== undefined && msg.user === this.botUserId) ||
        (this.botId !== undefined && msg.bot_id === this.botId);
      const isBotMessage = !!msg.bot_id || isFromSelf;

      let senderName: string;
      if (isFromSelf) {
        senderName = ASSISTANT_NAME;
      } else {
        senderName =
          (msg.user ? await this.resolveUserName(msg.user) : undefined) ||
          msg.user ||
          msg.bot_id ||
          'unknown';
      }

      // Translate mentions into TRIGGER_PATTERN format. We accept TWO forms:
      //   1. Proper Slack mention `<@U12345>` (Slack's encoded @ reference).
      //   2. Literal `@<botDisplayName>` text (e.g., "@Will-AI") — fallback
      //      for external AI peers that generate plain-text references rather
      //      than Slack's encoded mention syntax. Mirrors the convention
      //      Chanhyeok-AI's local listener uses.
      // Either match prepends `@${ASSISTANT_NAME}` so TRIGGER_PATTERN
      // (`^@<ASSISTANT_NAME>\b`) fires. Self-loop guard via !isFromSelf.
      let content = msg.text;
      if (this.botUserId && !isFromSelf) {
        const slackMention = `<@${this.botUserId}>`;
        const literalPatterns = [
          this.botUserName ? `@${this.botUserName}` : null,
          this.botDisplayName ? `@${this.botDisplayName}` : null,
        ].filter((p): p is string => p !== null);
        const hasMention =
          content.includes(slackMention) ||
          literalPatterns.some((p) => content.includes(p));
        if (hasMention && !TRIGGER_PATTERN.test(content)) {
          content = `@${ASSISTANT_NAME} ${content}`;
        }
      }

      void this.appendSlackEventLog({
        eventTs: timestamp,
        channel: msg.channel,
        userId: msg.user || msg.bot_id || '',
        threadTs: (msg as { thread_ts?: string }).thread_ts || '',
        text: msg.text ?? '',
      });

      this.opts.onMessage(jid, {
        id: msg.ts,
        chat_jid: jid,
        sender: msg.user || msg.bot_id || '',
        sender_name: senderName,
        content,
        timestamp,
        is_from_me: isFromSelf,
        is_bot_message: isBotMessage,
      });
    });
  }

  async connect(): Promise<void> {
    await this.app.start();

    // Get bot's own user ID for self-message detection.
    // Resolve this BEFORE setting connected=true so that messages arriving
    // during startup can correctly detect bot-sent messages.
    try {
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id as string;
      this.botUserName = auth.user as string | undefined;
      this.botId = (auth as { bot_id?: string }).bot_id;

      // Fetch the bot's display name (e.g. "Will-AI") so we can also accept
      // literal `@<displayName>` triggers. auth.test().user gives the
      // username slug (e.g. "willai"), which AIs rarely generate naturally.
      try {
        const info = await this.app.client.users.info({
          user: this.botUserId,
        });
        this.botDisplayName =
          info.user?.real_name || info.user?.profile?.display_name || undefined;
      } catch (err) {
        logger.warn(
          { err, botUserId: this.botUserId },
          'Could not fetch bot display name; literal display-name mentions will not trigger',
        );
      }

      logger.info(
        {
          botUserId: this.botUserId,
          botUserName: this.botUserName,
          botDisplayName: this.botDisplayName,
          botId: this.botId,
        },
        'Connected to Slack',
      );
    } catch (err) {
      logger.warn({ err }, 'Connected to Slack but failed to get bot user ID');
    }

    this.connected = true;

    // Flush any messages queued before connection
    await this.flushOutgoingQueue();

    // Sync channel names on startup
    await this.syncChannelMetadata();
  }

  async sendMessage(jid: string, text: string): Promise<void> {
    const channelId = jid.replace(/^slack:/, '');
    const finalText = this.enforcePeerMention(channelId, text);
    const chunks = this.splitMessage(finalText);

    if (!this.connected || this.outgoingQueue.length > 0 || this.flushing) {
      this.enqueueOutgoing(jid, chunks);
      logger.info(
        { jid, queueSize: this.outgoingQueue.length },
        this.connected
          ? 'Slack outgoing queue has pending items, message queued'
          : 'Slack disconnected, message queued',
      );
      this.scheduleOutgoingQueueFlush();
      return;
    }

    try {
      await this.postChunks(channelId, chunks);
      logger.info({ jid, length: finalText.length }, 'Slack message sent');
    } catch (err) {
      const failure = err as ChunkedPostFailure;
      const item = this.enqueueOutgoing(jid, failure.remainingChunks);
      logger.warn(
        { jid, err: failure.err, queueSize: this.outgoingQueue.length },
        'Failed to send Slack message, queued',
      );
      this.scheduleOutgoingQueueFlush(failure.retryAfterMs, item);
    }
  }

  /**
   * Split before posting so retry queue entries can keep only unsent chunks.
   */
  private splitMessage(text: string): string[] {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      return [text];
    }
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
      chunks.push(text.slice(i, i + MAX_MESSAGE_LENGTH));
    }
    return chunks;
  }

  /**
   * Post pre-split chunks sequentially. On failure, throws the unsent suffix so
   * queue retries do not duplicate chunks Slack already accepted.
   */
  private async postChunks(channelId: string, chunks: string[]): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      try {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: chunks[i],
        });
      } catch (err) {
        throw {
          err,
          remainingChunks: chunks.slice(i),
          retryAfterMs: retryAfterMsFromError(err),
        } satisfies ChunkedPostFailure;
      }
    }
  }

  /**
   * Guarantee a peer `<@USER_ID>` mention on outbound messages to AI-to-AI
   * channels configured via `SLACK_PEER_MENTIONS`. If the channel has a
   * configured peer and the outgoing text lacks that user's encoded mention,
   * prepend it.
   *
   * Why this exists: persona-level instructions to always mention the peer
   * proved unreliable — the agent rationalized short replies, verdicts, and
   * standby messages as "terminal" and dropped the mention, causing the
   * peer AI's listener to never fire and the AI-to-AI loop to stall
   * silently. This guard removes that failure mode at the transport layer.
   */
  private enforcePeerMention(channelId: string, text: string): string {
    const peerUserId = this.channelPeers.get(channelId);
    if (!peerUserId) return text;

    const mention = `<@${peerUserId}>`;
    const plainForm = `@${peerUserId}`;

    // Step 1: guarantee the first emitted chunk carries a mention.
    // `slice(0, MAX_MESSAGE_LENGTH).includes(mention)` returns true iff
    // the FULL token fits within chars 0..MAX-1, so a mention straddling
    // the chunk boundary is correctly treated as missing.
    const firstChunkHasMention = text
      .slice(0, MAX_MESSAGE_LENGTH)
      .includes(mention);
    let result = firstChunkHasMention ? text : `${mention} ${text}`;

    // Step 2: guarantee ONLY the first chunk fires the peer listener.
    // If the result extends past MAX_MESSAGE_LENGTH, replace any
    // `<@PEER>` occurrences in chunks 2+ with the bracket-less plain
    // form `@PEER`, which renders as text and does not trigger Slack's
    // mention detection. Without this, a later chunk containing the
    // mention would re-fire the peer's listener on the same logical
    // message — causing double-processing on the peer side.
    if (result.length > MAX_MESSAGE_LENGTH) {
      const head = result.slice(0, MAX_MESSAGE_LENGTH);
      const tail = result
        .slice(MAX_MESSAGE_LENGTH)
        .split(mention)
        .join(plainForm);
      result = head + tail;
    }

    if (result !== text) {
      logger.info(
        {
          channelId,
          peerUserId,
          originalLength: text.length,
          finalLength: result.length,
          prepended: !firstChunkHasMention,
          tailNeutralized:
            result.length > MAX_MESSAGE_LENGTH && text.includes(mention),
        },
        'Auto-prepended peer mention on outbound Slack message',
      );
    }
    return result;
  }

  isConnected(): boolean {
    return this.connected;
  }

  ownsJid(jid: string): boolean {
    return jid.startsWith('slack:');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.queueRetryTimer) {
      clearTimeout(this.queueRetryTimer);
      this.queueRetryTimer = undefined;
    }
    await this.app.stop();
  }

  // Slack does not expose a typing indicator API for bots.
  // This no-op satisfies the Channel interface so the orchestrator
  // doesn't need channel-specific branching.
  async setTyping(_jid: string, _isTyping: boolean): Promise<void> {
    // no-op: Slack Bot API has no typing indicator endpoint
  }

  /**
   * Sync channel metadata from Slack.
   * Fetches channels the bot is a member of and stores their names in the DB.
   */
  async syncChannelMetadata(): Promise<void> {
    try {
      logger.info('Syncing channel metadata from Slack...');
      let cursor: string | undefined;
      let count = 0;

      do {
        const result = await this.app.client.conversations.list({
          types: 'public_channel,private_channel',
          exclude_archived: true,
          limit: 200,
          cursor,
        });

        for (const ch of result.channels || []) {
          if (ch.id && ch.name && ch.is_member) {
            updateChatName(`slack:${ch.id}`, ch.name);
            count++;
          }
        }

        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);

      logger.info({ count }, 'Slack channel metadata synced');
    } catch (err) {
      logger.error({ err }, 'Failed to sync Slack channel metadata');
    }
  }

  private async resolveUserName(userId: string): Promise<string | undefined> {
    if (!userId) return undefined;

    const cached = this.userNameCache.get(userId);
    if (cached) return cached;

    try {
      const result = await this.app.client.users.info({ user: userId });
      const name = result.user?.real_name || result.user?.name;
      if (name) this.userNameCache.set(userId, name);
      return name;
    } catch (err) {
      logger.debug({ userId, err }, 'Failed to resolve Slack user name');
      return undefined;
    }
  }

  private async appendSlackEventLog(entry: SlackEventLogEntry): Promise<void> {
    if (!this.eventLogPath || this.eventLogDisabled) return;

    try {
      await appendFile(this.eventLogPath, formatSlackEventLogLine(entry));
    } catch (err) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code === 'ENOENT') {
        this.eventLogDisabled = true;
        logger.warn(
          { err, path: this.eventLogPath },
          'Slack event log path unavailable; disabling event log',
        );
        return;
      }

      logger.warn(
        { err, path: this.eventLogPath },
        'Failed to append Slack event log',
      );
    }
  }

  private async flushOutgoingQueue(): Promise<void> {
    if (!this.connected || this.flushing || this.outgoingQueue.length === 0) {
      return;
    }

    this.flushing = true;
    try {
      logger.info(
        { count: this.outgoingQueue.length },
        'Flushing Slack outgoing queue',
      );
      while (this.outgoingQueue.length > 0) {
        const item = this.outgoingQueue[0];
        const channelId = item.jid.replace(/^slack:/, '');
        try {
          await this.postChunks(channelId, item.chunks);
        } catch (err) {
          const failure = err as ChunkedPostFailure;
          item.chunks = failure.remainingChunks;
          logger.warn(
            {
              jid: item.jid,
              err: failure.err,
              queueSize: this.outgoingQueue.length,
            },
            'Failed to flush queued Slack message, will retry',
          );
          this.scheduleOutgoingQueueFlush(failure.retryAfterMs, item);
          return;
        }

        this.outgoingQueue.shift();
        logger.info(
          { jid: item.jid, length: item.chunks.join('').length },
          'Queued Slack message sent',
        );
      }
    } finally {
      this.flushing = false;
    }
  }

  private enqueueOutgoing(jid: string, chunks: string[]): OutgoingQueueItem {
    const item = { jid, chunks, retryAttempt: 0 };
    this.outgoingQueue.push(item);
    return item;
  }

  private retryDelayMs(retryAttempt: number): number {
    return Math.min(
      OUTGOING_QUEUE_RETRY_BASE_MS * 2 ** retryAttempt,
      OUTGOING_QUEUE_RETRY_MAX_MS,
    );
  }

  private scheduleOutgoingQueueFlush(
    retryAfterMs?: number,
    item?: OutgoingQueueItem,
  ): void {
    if (
      !this.connected ||
      this.outgoingQueue.length === 0 ||
      this.queueRetryTimer
    ) {
      return;
    }

    const delayMs =
      retryAfterMs ?? this.retryDelayMs(item ? item.retryAttempt : 0);
    if (item) item.retryAttempt += 1;

    this.queueRetryTimer = setTimeout(() => {
      this.queueRetryTimer = undefined;
      void this.flushOutgoingQueue();
    }, delayMs);

    if (
      typeof this.queueRetryTimer === 'object' &&
      this.queueRetryTimer &&
      'unref' in this.queueRetryTimer
    ) {
      this.queueRetryTimer.unref();
    }
  }
}

registerChannel('slack', (opts: ChannelOpts) => {
  const envVars = readEnvFile(['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN']);
  if (!envVars.SLACK_BOT_TOKEN || !envVars.SLACK_APP_TOKEN) {
    logger.warn('Slack: SLACK_BOT_TOKEN or SLACK_APP_TOKEN not set');
    return null;
  }
  return new SlackChannel(opts);
});
