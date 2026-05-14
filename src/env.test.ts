import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { readEnvFile } from './env.js';

const originalCwd = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('readEnvFile', () => {
  it('expands leading tilde for path-like env vars', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'nanoclaw-env-'));
    tempDirs.push(tempDir);
    process.chdir(tempDir);
    writeFileSync(
      '.env',
      [
        'SLACK_EVENT_LOG_PATH=~/test-tilde-expand.tsv',
        'ASSISTANT_NAME=~not-a-path',
      ].join('\n'),
    );

    expect(readEnvFile(['SLACK_EVENT_LOG_PATH', 'ASSISTANT_NAME'])).toEqual({
      SLACK_EVENT_LOG_PATH: join(homedir(), 'test-tilde-expand.tsv'),
      ASSISTANT_NAME: '~not-a-path',
    });
  });
});
