import type { RegisteredGroup, ScheduledTask } from './types.js';

type Row = Record<string, unknown>;

export type RegisteredGroupDecodeResult =
  | { ok: true; group: RegisteredGroup & { jid: string } }
  | {
      ok: false;
      reason: 'invalid_group_folder';
      jid: string;
      folder: string;
    };

function rowObject(value: unknown, label: string): Row {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label} row: expected object`);
  }
  return value as Row;
}

function stringField(row: Row, key: string, label: string): string {
  const value = row[key];
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${label} row: expected ${key} to be string`);
  }
  return value;
}

function nullableStringField(
  row: Row,
  key: string,
  label: string,
): string | null {
  const value = row[key];
  if (value !== null && typeof value !== 'string') {
    throw new Error(
      `Invalid ${label} row: expected ${key} to be string or null`,
    );
  }
  return value;
}

function nullableIntegerField(
  row: Row,
  key: string,
  label: string,
): number | null {
  const value = row[key];
  if (value !== null && typeof value !== 'number') {
    throw new Error(
      `Invalid ${label} row: expected ${key} to be number or null`,
    );
  }
  return value;
}

export function decodeScheduledTaskRow(row: unknown): ScheduledTask {
  const taskRow = rowObject(row, 'scheduled task');

  return {
    id: stringField(taskRow, 'id', 'scheduled task'),
    group_folder: stringField(taskRow, 'group_folder', 'scheduled task'),
    chat_jid: stringField(taskRow, 'chat_jid', 'scheduled task'),
    prompt: stringField(taskRow, 'prompt', 'scheduled task'),
    schedule_type: stringField(
      taskRow,
      'schedule_type',
      'scheduled task',
    ) as ScheduledTask['schedule_type'],
    schedule_value: stringField(taskRow, 'schedule_value', 'scheduled task'),
    context_mode: stringField(
      taskRow,
      'context_mode',
      'scheduled task',
    ) as ScheduledTask['context_mode'],
    next_run: nullableStringField(taskRow, 'next_run', 'scheduled task'),
    last_run: nullableStringField(taskRow, 'last_run', 'scheduled task'),
    last_result: nullableStringField(taskRow, 'last_result', 'scheduled task'),
    status: stringField(
      taskRow,
      'status',
      'scheduled task',
    ) as ScheduledTask['status'],
    created_at: stringField(taskRow, 'created_at', 'scheduled task'),
  };
}

export function decodeRegisteredGroupRow(
  row: unknown,
  isValidGroupFolder: (folder: string) => boolean,
): RegisteredGroupDecodeResult {
  const groupRow = rowObject(row, 'registered group');
  const jid = stringField(groupRow, 'jid', 'registered group');
  const name = stringField(groupRow, 'name', 'registered group');
  const folder = stringField(groupRow, 'folder', 'registered group');

  if (!isValidGroupFolder(folder)) {
    return { ok: false, reason: 'invalid_group_folder', jid, folder };
  }

  const trigger = stringField(groupRow, 'trigger_pattern', 'registered group');
  const addedAt = stringField(groupRow, 'added_at', 'registered group');
  const containerConfigJson = nullableStringField(
    groupRow,
    'container_config',
    'registered group',
  );
  const requiresTrigger = nullableIntegerField(
    groupRow,
    'requires_trigger',
    'registered group',
  );
  const isMain = nullableIntegerField(groupRow, 'is_main', 'registered group');

  return {
    ok: true,
    group: {
      jid,
      name,
      folder,
      trigger,
      added_at: addedAt,
      containerConfig: containerConfigJson
        ? JSON.parse(containerConfigJson)
        : undefined,
      requiresTrigger:
        requiresTrigger === null ? undefined : requiresTrigger === 1,
      isMain: isMain === 1 ? true : undefined,
    },
  };
}
