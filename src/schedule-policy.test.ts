import { describe, expect, it } from 'vitest';

import {
  computeInitialNextRun,
  computeRecurringNextRun,
  computeUpdatedNextRun,
  validateScheduleInput,
} from './schedule-policy.js';

const TZ = 'UTC';
const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function currentTask(
  overrides: Partial<{
    schedule_type: 'cron' | 'interval' | 'once';
    schedule_value: string;
    next_run: string | null;
  }> = {},
) {
  return {
    schedule_type: 'interval' as const,
    schedule_value: '60000',
    next_run: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateScheduleInput', () => {
  it('accepts valid cron, interval, and once inputs', () => {
    expect(
      validateScheduleInput({
        scheduleType: 'cron',
        scheduleValue: '0 9 * * *',
        timezone: TZ,
      }),
    ).toMatchObject({ ok: true, input: { scheduleType: 'cron' } });
    expect(
      validateScheduleInput({
        scheduleType: 'interval',
        scheduleValue: '300000',
        timezone: TZ,
      }),
    ).toMatchObject({ ok: true, input: { scheduleType: 'interval' } });
    expect(
      validateScheduleInput({
        scheduleType: 'once',
        scheduleValue: '2026-02-01T15:30:00',
        timezone: TZ,
      }),
    ).toMatchObject({ ok: true, input: { scheduleType: 'once' } });
  });

  it('rejects unknown schedule_type', () => {
    expect(
      validateScheduleInput({
        scheduleType: 'weekly',
        scheduleValue: '0 9 * * *',
        timezone: TZ,
      }),
    ).toEqual({
      ok: false,
      reason: 'invalid_schedule_type',
      scheduleType: 'weekly',
      scheduleValue: '0 9 * * *',
    });
  });
});

describe('computeInitialNextRun', () => {
  it('rejects invalid cron', () => {
    expect(
      computeInitialNextRun({
        scheduleType: 'cron',
        scheduleValue: 'not a cron',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_cron' });
  });

  it('computes cron next_run with provided timezone', () => {
    const decision = computeInitialNextRun({
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
      timezone: 'America/New_York',
      nowMs: NOW,
    });

    expect(decision).toEqual({
      ok: true,
      scheduleType: 'cron',
      scheduleValue: '0 9 * * *',
      nextRun: '2026-01-01T14:00:00.000Z',
    });
  });

  it('computes interval from nowMs plus parsed milliseconds', () => {
    expect(
      computeInitialNextRun({
        scheduleType: 'interval',
        scheduleValue: '300000',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toEqual({
      ok: true,
      scheduleType: 'interval',
      scheduleValue: '300000',
      nextRun: '2026-01-01T00:05:00.000Z',
    });
  });

  it('rejects zero and non-numeric intervals', () => {
    expect(
      computeInitialNextRun({
        scheduleType: 'interval',
        scheduleValue: '0',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_interval' });
    expect(
      computeInitialNextRun({
        scheduleType: 'interval',
        scheduleValue: 'abc',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, reason: 'invalid_interval' });
  });

  it('computes once via Date parsing', () => {
    expect(
      computeInitialNextRun({
        scheduleType: 'once',
        scheduleValue: '2026-02-01T15:30:00.000Z',
        timezone: TZ,
      }),
    ).toEqual({
      ok: true,
      scheduleType: 'once',
      scheduleValue: '2026-02-01T15:30:00.000Z',
      nextRun: '2026-02-01T15:30:00.000Z',
    });
  });

  it('does not apply the container no-Z once guard', () => {
    expect(
      computeInitialNextRun({
        scheduleType: 'once',
        scheduleValue: '2026-02-01T15:30:00Z',
        timezone: TZ,
      }),
    ).toMatchObject({
      ok: true,
      nextRun: '2026-02-01T15:30:00.000Z',
    });
  });
});

describe('computeUpdatedNextRun', () => {
  it('recomputes cron next_run on cron schedule changes', () => {
    expect(
      computeUpdatedNextRun({
        currentTask: currentTask({ schedule_type: 'interval' }),
        scheduleType: 'cron',
        scheduleValue: '0 9 * * *',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toEqual({
      ok: true,
      effectiveScheduleType: 'cron',
      effectiveScheduleValue: '0 9 * * *',
      nextRunChanged: true,
      nextRun: '2026-01-01T09:00:00.000Z',
      reason: 'cron_next_run',
    });
  });

  it('recomputes interval next_run on valid interval changes', () => {
    expect(
      computeUpdatedNextRun({
        currentTask: currentTask(),
        scheduleValue: '120000',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toEqual({
      ok: true,
      effectiveScheduleType: 'interval',
      effectiveScheduleValue: '120000',
      nextRunChanged: true,
      nextRun: '2026-01-01T00:02:00.000Z',
      reason: 'interval_next_run',
    });
  });

  it('preserves current once-update behavior', () => {
    expect(
      computeUpdatedNextRun({
        currentTask: currentTask(),
        scheduleType: 'once',
        scheduleValue: '2026-01-02T00:00:00.000Z',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toEqual({
      ok: true,
      effectiveScheduleType: 'once',
      effectiveScheduleValue: '2026-01-02T00:00:00.000Z',
      nextRunChanged: false,
      reason: 'once_update_preserves_existing_next_run',
    });
  });

  it('preserves current invalid-interval update behavior', () => {
    expect(
      computeUpdatedNextRun({
        currentTask: currentTask(),
        scheduleValue: '0',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toEqual({
      ok: true,
      effectiveScheduleType: 'interval',
      effectiveScheduleValue: '0',
      nextRunChanged: false,
      reason: 'invalid_interval_update_preserves_existing_next_run',
    });
  });

  it('rejects invalid cron updates', () => {
    expect(
      computeUpdatedNextRun({
        currentTask: currentTask({ schedule_type: 'cron' }),
        scheduleValue: 'not a cron',
        timezone: TZ,
        nowMs: NOW,
      }),
    ).toEqual({
      ok: false,
      reason: 'invalid_cron',
      scheduleType: 'cron',
      scheduleValue: 'not a cron',
    });
  });
});

describe('computeRecurringNextRun', () => {
  it('returns null for once tasks', () => {
    expect(
      computeRecurringNextRun(
        currentTask({ schedule_type: 'once', schedule_value: '2026-01-01' }),
        { timezone: TZ, nowMs: NOW },
      ),
    ).toEqual({ ok: true, nextRun: null, reason: 'once_task' });
  });

  it('anchors intervals to task.next_run and skips missed intervals', () => {
    expect(
      computeRecurringNextRun(
        currentTask({
          schedule_type: 'interval',
          schedule_value: '60000',
          next_run: '2026-01-01T00:00:00.000Z',
        }),
        {
          timezone: TZ,
          nowMs: Date.parse('2026-01-01T00:10:30.000Z'),
        },
      ),
    ).toEqual({
      ok: true,
      nextRun: '2026-01-01T00:11:00.000Z',
      reason: 'interval_next_run',
    });
  });

  it('returns invalid-interval fallback decision', () => {
    expect(
      computeRecurringNextRun(
        currentTask({ schedule_type: 'interval', schedule_value: 'abc' }),
        { timezone: TZ, nowMs: NOW },
      ),
    ).toEqual({
      ok: false,
      reason: 'invalid_interval',
      fallbackNextRun: '2026-01-01T00:01:00.000Z',
    });
  });
});
