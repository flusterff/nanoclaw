import { describe, expect, it } from 'vitest';

import { ASSISTANT_NAME } from './config.js';
import {
  decideAgentCursorAfterRun,
  decideLiveDispatch,
  decideMessageDispatch,
} from './message-dispatch.js';
import { NewMessage, RegisteredGroup } from './types.js';

const TZ = 'UTC';
const CHAT_JID = 'group@g.us';

function group(overrides: Partial<RegisteredGroup> = {}): RegisteredGroup {
  return {
    name: 'Test Group',
    folder: 'test-group',
    trigger: `@${ASSISTANT_NAME}`,
    added_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function message(overrides: Partial<NewMessage> = {}): NewMessage {
  return {
    id: '1',
    chat_jid: CHAT_JID,
    sender: 'alice@s.whatsapp.net',
    sender_name: 'Alice',
    content: 'hello',
    timestamp: '2024-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('decideMessageDispatch', () => {
  it('skips non-main groups that require a trigger when no trigger is present', () => {
    const decision = decideMessageDispatch({
      group: group(),
      chatJid: CHAT_JID,
      newMessages: [message({ content: 'plain chatter' })],
      lastAgentCursor: '',
      allowlist: '*',
      timezone: TZ,
    });

    expect(decision).toMatchObject({
      shouldProcess: false,
      messageCount: 0,
      reason: 'trigger_required',
    });
  });

  it('processes a non-main group when an authorized trigger is present', () => {
    const decision = decideMessageDispatch({
      group: group(),
      chatJid: CHAT_JID,
      newMessages: [
        message({ content: 'context', timestamp: '2024-01-01T00:00:01.000Z' }),
        message({
          id: '2',
          content: `@${ASSISTANT_NAME} respond`,
          timestamp: '2024-01-01T00:00:02.000Z',
        }),
      ],
      lastAgentCursor: '',
      allowlist: ['alice@s.whatsapp.net'],
      timezone: TZ,
    });

    expect(decision.shouldProcess).toBe(true);
    expect(decision.reason).toBe('trigger_allowed');
    expect(decision.messageCount).toBe(2);
    expect(decision.newAgentCursor).toBe('2024-01-01T00:00:02.000Z');
    expect(decision.prompt).toContain(`@${ASSISTANT_NAME} respond`);
  });

  it('skips a trigger from a denied sender in a non-main group', () => {
    const decision = decideMessageDispatch({
      group: group(),
      chatJid: CHAT_JID,
      newMessages: [
        message({
          content: `@${ASSISTANT_NAME} respond`,
          sender: 'mallory@s.whatsapp.net',
        }),
      ],
      lastAgentCursor: '',
      allowlist: ['alice@s.whatsapp.net'],
      timezone: TZ,
    });

    expect(decision).toMatchObject({
      shouldProcess: false,
      messageCount: 0,
      reason: 'trigger_denied',
    });
  });

  it('uses pending messages for prompt and cursor after a new trigger arrives', () => {
    const decision = decideMessageDispatch({
      group: group(),
      chatJid: CHAT_JID,
      newMessages: [
        message({
          id: '3',
          content: `@${ASSISTANT_NAME} now`,
          timestamp: '2024-01-01T00:00:03.000Z',
        }),
      ],
      pendingMessages: [
        message({ content: 'older context' }),
        message({
          id: '2',
          content: 'newer context',
          timestamp: '2024-01-01T00:00:02.000Z',
        }),
        message({
          id: '3',
          content: `@${ASSISTANT_NAME} now`,
          timestamp: '2024-01-01T00:00:03.000Z',
        }),
      ],
      lastAgentCursor: '',
      allowlist: '*',
      timezone: TZ,
    });

    expect(decision.shouldProcess).toBe(true);
    expect(decision.messageCount).toBe(3);
    expect(decision.newAgentCursor).toBe('2024-01-01T00:00:03.000Z');
    expect(decision.prompt).toContain('older context');
    expect(decision.prompt).toContain('newer context');
  });
});

describe('decideLiveDispatch', () => {
  it('advances the cursor when a prompt is piped to an active container', () => {
    const decision = decideMessageDispatch({
      group: group({ isMain: true }),
      chatJid: CHAT_JID,
      newMessages: [message()],
      lastAgentCursor: '',
      timezone: TZ,
    });

    expect(decideLiveDispatch(decision, true)).toMatchObject({
      action: 'pipe',
      newAgentCursor: '2024-01-01T00:00:01.000Z',
      reason: 'piped_to_active_container',
    });
  });

  it('enqueues without advancing the cursor when no active container accepts the prompt', () => {
    const decision = decideMessageDispatch({
      group: group({ isMain: true }),
      chatJid: CHAT_JID,
      newMessages: [message()],
      lastAgentCursor: '',
      timezone: TZ,
    });

    expect(decideLiveDispatch(decision, false)).toMatchObject({
      action: 'enqueue',
      reason: 'no_active_container',
    });
    expect(decideLiveDispatch(decision, false).newAgentCursor).toBeUndefined();
  });
});

describe('decideAgentCursorAfterRun', () => {
  it('rolls back the cursor after an agent error with no streamed output', () => {
    expect(
      decideAgentCursorAfterRun({
        previousCursor: '2024-01-01T00:00:00.000Z',
        attemptedCursor: '2024-01-01T00:00:01.000Z',
        agentErrored: true,
        outputSentToUser: false,
      }),
    ).toEqual({
      cursor: '2024-01-01T00:00:00.000Z',
      shouldRollback: true,
      shouldRetry: true,
      reason: 'agent_error_rollback',
    });
  });

  it('keeps the cursor after an agent error when output was already streamed', () => {
    expect(
      decideAgentCursorAfterRun({
        previousCursor: '2024-01-01T00:00:00.000Z',
        attemptedCursor: '2024-01-01T00:00:01.000Z',
        agentErrored: true,
        outputSentToUser: true,
      }),
    ).toEqual({
      cursor: '2024-01-01T00:00:01.000Z',
      shouldRollback: false,
      shouldRetry: false,
      reason: 'agent_error_after_output',
    });
  });
});
