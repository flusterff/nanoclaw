import { CronExpressionParser } from 'cron-parser';

import type { ScheduledTask } from './types.js';

export type ScheduleType = ScheduledTask['schedule_type'];

export type ScheduleInvalidReason =
  | 'missing_schedule_type'
  | 'missing_schedule_value'
  | 'invalid_schedule_type'
  | 'invalid_cron'
  | 'invalid_interval'
  | 'invalid_once_timestamp';

export interface RawScheduleInput {
  scheduleType?: string;
  scheduleValue?: string;
  timezone: string;
  nowMs?: number;
}

export interface ScheduleInput {
  scheduleType: ScheduleType;
  scheduleValue: string;
  timezone: string;
  nowMs?: number;
}

export type ScheduleValidationDecision =
  | { ok: true; input: ScheduleInput }
  | {
      ok: false;
      reason: ScheduleInvalidReason;
      scheduleType?: string;
      scheduleValue?: string;
    };

export type InitialNextRunDecision =
  | {
      ok: true;
      scheduleType: ScheduleType;
      scheduleValue: string;
      nextRun: string;
    }
  | {
      ok: false;
      reason: ScheduleInvalidReason;
      scheduleType?: string;
      scheduleValue?: string;
    };

export interface ScheduleUpdateInput {
  currentTask: Pick<
    ScheduledTask,
    'schedule_type' | 'schedule_value' | 'next_run'
  >;
  scheduleType?: string;
  scheduleValue?: string;
  timezone: string;
  nowMs?: number;
}

export type ScheduleUpdateDecision =
  | {
      ok: true;
      effectiveScheduleType: ScheduleType;
      effectiveScheduleValue: string;
      nextRunChanged: boolean;
      nextRun?: string;
      reason:
        | 'schedule_unchanged'
        | 'cron_next_run'
        | 'interval_next_run'
        | 'once_update_preserves_existing_next_run'
        | 'invalid_interval_update_preserves_existing_next_run';
    }
  | {
      ok: false;
      reason: ScheduleInvalidReason;
      scheduleType?: string;
      scheduleValue?: string;
    };

export interface RecurringNextRunOptions {
  timezone: string;
  nowMs?: number;
}

export type RecurringNextRunDecision =
  | {
      ok: true;
      nextRun: string | null;
      reason:
        | 'once_task'
        | 'cron_next_run'
        | 'interval_next_run'
        | 'unknown_schedule_type';
    }
  | {
      ok: false;
      reason: 'invalid_cron' | 'invalid_interval';
      fallbackNextRun?: string;
    };

function isScheduleType(value: string): value is ScheduleType {
  return value === 'cron' || value === 'interval' || value === 'once';
}

function cronOptions(
  timezone: string,
  nowMs?: number,
): { tz: string; currentDate?: Date } {
  const options: { tz: string; currentDate?: Date } = { tz: timezone };
  if (nowMs !== undefined) {
    options.currentDate = new Date(nowMs);
  }
  return options;
}

function invalidDecision(
  reason: ScheduleInvalidReason,
  input: Pick<RawScheduleInput, 'scheduleType' | 'scheduleValue'>,
): {
  ok: false;
  reason: ScheduleInvalidReason;
  scheduleType?: string;
  scheduleValue?: string;
} {
  return {
    ok: false,
    reason,
    scheduleType: input.scheduleType,
    scheduleValue: input.scheduleValue,
  };
}

function cronNextIso(
  scheduleValue: string,
  timezone: string,
  nowMs?: number,
): string {
  const nextRun = CronExpressionParser.parse(
    scheduleValue,
    cronOptions(timezone, nowMs),
  )
    .next()
    .toISOString();
  if (nextRun === null) {
    throw new Error('Cron parser returned null next run');
  }
  return nextRun;
}

export function validateScheduleInput(
  input: RawScheduleInput,
): ScheduleValidationDecision {
  if (input.scheduleType === undefined) {
    return invalidDecision('missing_schedule_type', input);
  }
  if (input.scheduleValue === undefined) {
    return invalidDecision('missing_schedule_value', input);
  }
  if (!isScheduleType(input.scheduleType)) {
    return invalidDecision('invalid_schedule_type', input);
  }

  return {
    ok: true,
    input: {
      scheduleType: input.scheduleType,
      scheduleValue: input.scheduleValue,
      timezone: input.timezone,
      nowMs: input.nowMs,
    },
  };
}

export function computeInitialNextRun(
  input: RawScheduleInput,
): InitialNextRunDecision {
  const validation = validateScheduleInput(input);
  if (!validation.ok) return validation;

  const { scheduleType, scheduleValue, timezone, nowMs } = validation.input;

  if (scheduleType === 'cron') {
    try {
      return {
        ok: true,
        scheduleType,
        scheduleValue,
        nextRun: cronNextIso(scheduleValue, timezone, nowMs),
      };
    } catch {
      return invalidDecision('invalid_cron', input);
    }
  }

  if (scheduleType === 'interval') {
    const ms = parseInt(scheduleValue, 10);
    if (isNaN(ms) || ms <= 0) {
      return invalidDecision('invalid_interval', input);
    }
    return {
      ok: true,
      scheduleType,
      scheduleValue,
      nextRun: new Date((nowMs ?? Date.now()) + ms).toISOString(),
    };
  }

  const date = new Date(scheduleValue);
  if (isNaN(date.getTime())) {
    return invalidDecision('invalid_once_timestamp', input);
  }
  return {
    ok: true,
    scheduleType,
    scheduleValue,
    nextRun: date.toISOString(),
  };
}

export function computeUpdatedNextRun(
  input: ScheduleUpdateInput,
): ScheduleUpdateDecision {
  if (input.scheduleType === undefined && input.scheduleValue === undefined) {
    return {
      ok: true,
      effectiveScheduleType: input.currentTask.schedule_type,
      effectiveScheduleValue: input.currentTask.schedule_value,
      nextRunChanged: false,
      reason: 'schedule_unchanged',
    };
  }

  if (input.scheduleType !== undefined && !isScheduleType(input.scheduleType)) {
    return invalidDecision('invalid_schedule_type', input);
  }

  const effectiveScheduleType =
    input.scheduleType ?? input.currentTask.schedule_type;
  const effectiveScheduleValue =
    input.scheduleValue ?? input.currentTask.schedule_value;

  if (effectiveScheduleType === 'cron') {
    try {
      return {
        ok: true,
        effectiveScheduleType,
        effectiveScheduleValue,
        nextRunChanged: true,
        nextRun: cronNextIso(
          effectiveScheduleValue,
          input.timezone,
          input.nowMs,
        ),
        reason: 'cron_next_run',
      };
    } catch {
      return invalidDecision('invalid_cron', {
        scheduleType: effectiveScheduleType,
        scheduleValue: effectiveScheduleValue,
      });
    }
  }

  if (effectiveScheduleType === 'interval') {
    const ms = parseInt(effectiveScheduleValue, 10);
    if (!isNaN(ms) && ms > 0) {
      return {
        ok: true,
        effectiveScheduleType,
        effectiveScheduleValue,
        nextRunChanged: true,
        nextRun: new Date((input.nowMs ?? Date.now()) + ms).toISOString(),
        reason: 'interval_next_run',
      };
    }

    return {
      ok: true,
      effectiveScheduleType,
      effectiveScheduleValue,
      nextRunChanged: false,
      reason: 'invalid_interval_update_preserves_existing_next_run',
    };
  }

  return {
    ok: true,
    effectiveScheduleType,
    effectiveScheduleValue,
    nextRunChanged: false,
    reason: 'once_update_preserves_existing_next_run',
  };
}

export function computeRecurringNextRun(
  task: Pick<ScheduledTask, 'schedule_type' | 'schedule_value' | 'next_run'>,
  options: RecurringNextRunOptions,
): RecurringNextRunDecision {
  if (task.schedule_type === 'once') {
    return { ok: true, nextRun: null, reason: 'once_task' };
  }

  const now = options.nowMs ?? Date.now();

  if (task.schedule_type === 'cron') {
    try {
      return {
        ok: true,
        nextRun: cronNextIso(
          task.schedule_value,
          options.timezone,
          options.nowMs,
        ),
        reason: 'cron_next_run',
      };
    } catch {
      return { ok: false, reason: 'invalid_cron' };
    }
  }

  if (task.schedule_type === 'interval') {
    const ms = parseInt(task.schedule_value, 10);
    if (!ms || ms <= 0) {
      return {
        ok: false,
        reason: 'invalid_interval',
        fallbackNextRun: new Date(now + 60_000).toISOString(),
      };
    }

    let next = new Date(task.next_run!).getTime() + ms;
    while (next <= now) {
      next += ms;
    }

    return {
      ok: true,
      nextRun: new Date(next).toISOString(),
      reason: 'interval_next_run',
    };
  }

  // Unknown schedule_type (e.g., legacy/corrupt DB row): match the previous
  // `return null` fallthrough in computeNextRun so the task completes after its
  // due run instead of being parseInt-coerced into an interval reschedule.
  return { ok: true, nextRun: null, reason: 'unknown_schedule_type' };
}
