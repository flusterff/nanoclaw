import { TRIGGER_PATTERN } from './config.js';
import { formatMessages } from './router.js';
import { NewMessage, RegisteredGroup } from './types.js';

export type DispatchAllowlist = '*' | string[];

export interface DispatchInput {
  group: RegisteredGroup;
  chatJid: string;
  newMessages: NewMessage[];
  pendingMessages?: NewMessage[];
  lastAgentCursor: string;
  allowlist?: DispatchAllowlist;
  timezone: string;
  isTriggerAllowedSender?: (sender: string, message: NewMessage) => boolean;
}

export interface DispatchDecision {
  shouldProcess: boolean;
  prompt?: string;
  newAgentCursor?: string;
  messageCount: number;
  reason: string;
}

export interface LiveDispatchDecision {
  action: 'skip' | 'pipe' | 'enqueue';
  newAgentCursor?: string;
  reason: string;
}

export interface AgentCursorInput {
  previousCursor: string;
  attemptedCursor: string;
  agentErrored: boolean;
  outputSentToUser: boolean;
}

export interface AgentCursorDecision {
  cursor: string;
  shouldRollback: boolean;
  shouldRetry: boolean;
  reason: string;
}

function requiresTrigger(group: RegisteredGroup): boolean {
  return group.isMain !== true && group.requiresTrigger !== false;
}

function isSenderAuthorized(
  input: DispatchInput,
  message: NewMessage,
): boolean {
  if (message.is_from_me) return true;
  if (input.isTriggerAllowedSender) {
    return input.isTriggerAllowedSender(message.sender, message);
  }
  const allowlist = input.allowlist ?? '*';
  return allowlist === '*' || allowlist.includes(message.sender);
}

function findTrigger(input: DispatchInput): {
  hasTriggerSyntax: boolean;
  hasAuthorizedTrigger: boolean;
} {
  let hasTriggerSyntax = false;

  for (const message of input.newMessages) {
    if (!TRIGGER_PATTERN.test(message.content.trim())) continue;
    hasTriggerSyntax = true;
    if (isSenderAuthorized(input, message)) {
      return { hasTriggerSyntax, hasAuthorizedTrigger: true };
    }
  }

  return { hasTriggerSyntax, hasAuthorizedTrigger: false };
}

export function decideMessageDispatch(input: DispatchInput): DispatchDecision {
  if (input.newMessages.length === 0) {
    return {
      shouldProcess: false,
      messageCount: 0,
      reason: 'no_messages',
    };
  }

  let reason = 'trigger_not_required';
  if (input.group.isMain === true) {
    reason = 'main_group';
  } else if (requiresTrigger(input.group)) {
    const trigger = findTrigger(input);
    if (!trigger.hasAuthorizedTrigger) {
      return {
        shouldProcess: false,
        messageCount: 0,
        reason: trigger.hasTriggerSyntax
          ? 'trigger_denied'
          : 'trigger_required',
      };
    }
    reason = 'trigger_allowed';
  }

  const messagesToProcess =
    input.pendingMessages && input.pendingMessages.length > 0
      ? input.pendingMessages
      : input.newMessages;
  const lastMessage = messagesToProcess[messagesToProcess.length - 1];

  return {
    shouldProcess: true,
    prompt: formatMessages(messagesToProcess, input.timezone),
    newAgentCursor: lastMessage.timestamp,
    messageCount: messagesToProcess.length,
    reason,
  };
}

export function decideLiveDispatch(
  decision: DispatchDecision,
  sentToActiveContainer: boolean,
): LiveDispatchDecision {
  if (!decision.shouldProcess) {
    return { action: 'skip', reason: decision.reason };
  }

  if (sentToActiveContainer) {
    return {
      action: 'pipe',
      newAgentCursor: decision.newAgentCursor,
      reason: 'piped_to_active_container',
    };
  }

  return { action: 'enqueue', reason: 'no_active_container' };
}

export function decideAgentCursorAfterRun(
  input: AgentCursorInput,
): AgentCursorDecision {
  if (!input.agentErrored) {
    return {
      cursor: input.attemptedCursor,
      shouldRollback: false,
      shouldRetry: false,
      reason: 'agent_success',
    };
  }

  if (input.outputSentToUser) {
    return {
      cursor: input.attemptedCursor,
      shouldRollback: false,
      shouldRetry: false,
      reason: 'agent_error_after_output',
    };
  }

  return {
    cursor: input.previousCursor,
    shouldRollback: true,
    shouldRetry: true,
    reason: 'agent_error_rollback',
  };
}
