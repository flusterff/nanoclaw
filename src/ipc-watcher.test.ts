import { describe, expect, it } from 'vitest';

import { isMessageAuthorized } from './ipc-watcher.js';
import type { RegisteredGroup } from './types.js';

const groups: Record<string, RegisteredGroup> = {
  'main@g.us': {
    name: 'Main',
    folder: 'whatsapp_main',
    trigger: 'always',
    added_at: '2024-01-01T00:00:00.000Z',
    isMain: true,
  },
  'other@g.us': {
    name: 'Other',
    folder: 'other-group',
    trigger: '@Andy',
    added_at: '2024-01-01T00:00:00.000Z',
  },
  'third@g.us': {
    name: 'Third',
    folder: 'third-group',
    trigger: '@Andy',
    added_at: '2024-01-01T00:00:00.000Z',
  },
};

// --- IPC message authorization ---
// Tests the authorization pattern from startIpcWatcher (ipc-watcher.ts).
// The logic: isMain || (targetGroup && targetGroup.folder === sourceGroup)

describe('IPC message authorization', () => {
  it('main group can send to any group', () => {
    expect(
      isMessageAuthorized('whatsapp_main', true, 'other@g.us', groups),
    ).toBe(true);
    expect(
      isMessageAuthorized('whatsapp_main', true, 'third@g.us', groups),
    ).toBe(true);
  });

  it('non-main group can send to its own chat', () => {
    expect(
      isMessageAuthorized('other-group', false, 'other@g.us', groups),
    ).toBe(true);
  });

  it('non-main group cannot send to another groups chat', () => {
    expect(isMessageAuthorized('other-group', false, 'main@g.us', groups)).toBe(
      false,
    );
    expect(
      isMessageAuthorized('other-group', false, 'third@g.us', groups),
    ).toBe(false);
  });

  it('non-main group cannot send to unregistered JID', () => {
    expect(
      isMessageAuthorized('other-group', false, 'unknown@g.us', groups),
    ).toBe(false);
  });

  it('main group can send to unregistered JID', () => {
    // Main is always authorized regardless of target
    expect(
      isMessageAuthorized('whatsapp_main', true, 'unknown@g.us', groups),
    ).toBe(true);
  });
});
