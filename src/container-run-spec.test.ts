import { describe, expect, it } from 'vitest';

import {
  buildContainerName,
  buildContainerRunSpec,
  type ContainerRunSpecInput,
  type VolumeMount,
} from './container-run-spec.js';

type ContainerRunSpecInputOverrides = Omit<
  Partial<ContainerRunSpecInput>,
  'paths' | 'facts' | 'runtime'
> & {
  paths?: Partial<ContainerRunSpecInput['paths']>;
  facts?: Partial<ContainerRunSpecInput['facts']>;
  runtime?: Partial<ContainerRunSpecInput['runtime']>;
};

function baseInput(
  overrides: ContainerRunSpecInputOverrides = {},
): ContainerRunSpecInput {
  const base: ContainerRunSpecInput = {
    groupFolder: 'test-group',
    isMain: false,
    containerName: 'nanoclaw-test-group-123',
    paths: {
      projectRoot: '/repo/nanoclaw',
      groupDir: '/data/groups/test-group',
      globalDir: '/data/groups/global',
      groupSessionsDir: '/data/sessions/test-group/.claude',
      groupIpcDir: '/data/ipc/test-group',
      groupAgentRunnerDir: '/data/sessions/test-group/agent-runner-src',
    },
    facts: {
      projectEnvFileExists: false,
      globalDirExists: false,
    },
    runtime: {
      command: 'docker',
      image: 'nanoclaw-agent:latest',
      timezone: 'America/Los_Angeles',
      credentialProxyHost: 'host.docker.internal',
      credentialProxyPort: 3001,
      authMode: 'api-key',
      hostGatewayArgs: [],
    },
    validatedAdditionalMounts: [],
  };

  return {
    ...base,
    ...overrides,
    paths: { ...base.paths, ...overrides.paths },
    facts: { ...base.facts, ...overrides.facts },
    runtime: { ...base.runtime, ...overrides.runtime },
    validatedAdditionalMounts:
      overrides.validatedAdditionalMounts ?? base.validatedAdditionalMounts,
  };
}

describe('buildContainerRunSpec mounts', () => {
  it('builds the exact main mount list with project root and .env shadow', () => {
    const spec = buildContainerRunSpec(
      baseInput({
        isMain: true,
        facts: {
          projectEnvFileExists: true,
          globalDirExists: true,
        },
      }),
    );

    expect(spec.mounts).toEqual([
      {
        hostPath: '/repo/nanoclaw',
        containerPath: '/workspace/project',
        readonly: true,
      },
      {
        hostPath: '/dev/null',
        containerPath: '/workspace/project/.env',
        readonly: true,
      },
      {
        hostPath: '/data/groups/test-group',
        containerPath: '/workspace/group',
        readonly: false,
      },
      {
        hostPath: '/data/sessions/test-group/.claude',
        containerPath: '/home/node/.claude',
        readonly: false,
      },
      {
        hostPath: '/data/ipc/test-group',
        containerPath: '/workspace/ipc',
        readonly: false,
      },
      {
        hostPath: '/data/sessions/test-group/agent-runner-src',
        containerPath: '/app/src',
        readonly: false,
      },
    ]);
  });

  it('builds the exact non-main mount list without project root or .env shadow', () => {
    const spec = buildContainerRunSpec(
      baseInput({
        isMain: false,
        facts: {
          projectEnvFileExists: true,
          globalDirExists: false,
        },
      }),
    );

    expect(spec.mounts).toEqual([
      {
        hostPath: '/data/groups/test-group',
        containerPath: '/workspace/group',
        readonly: false,
      },
      {
        hostPath: '/data/sessions/test-group/.claude',
        containerPath: '/home/node/.claude',
        readonly: false,
      },
      {
        hostPath: '/data/ipc/test-group',
        containerPath: '/workspace/ipc',
        readonly: false,
      },
      {
        hostPath: '/data/sessions/test-group/agent-runner-src',
        containerPath: '/app/src',
        readonly: false,
      },
    ]);
    expect(spec.mounts).not.toContainEqual(
      expect.objectContaining({ containerPath: '/workspace/project' }),
    );
    expect(spec.mounts).not.toContainEqual(
      expect.objectContaining({ containerPath: '/workspace/project/.env' }),
    );
  });

  it('includes non-main global memory only when the global directory exists', () => {
    const withGlobal = buildContainerRunSpec(
      baseInput({
        facts: {
          projectEnvFileExists: false,
          globalDirExists: true,
        },
      }),
    );
    const withoutGlobal = buildContainerRunSpec(
      baseInput({
        facts: {
          projectEnvFileExists: false,
          globalDirExists: false,
        },
      }),
    );

    expect(withGlobal.mounts).toEqual([
      {
        hostPath: '/data/groups/test-group',
        containerPath: '/workspace/group',
        readonly: false,
      },
      {
        hostPath: '/data/groups/global',
        containerPath: '/workspace/global',
        readonly: true,
      },
      {
        hostPath: '/data/sessions/test-group/.claude',
        containerPath: '/home/node/.claude',
        readonly: false,
      },
      {
        hostPath: '/data/ipc/test-group',
        containerPath: '/workspace/ipc',
        readonly: false,
      },
      {
        hostPath: '/data/sessions/test-group/agent-runner-src',
        containerPath: '/app/src',
        readonly: false,
      },
    ]);
    expect(withoutGlobal.mounts).not.toContainEqual(
      expect.objectContaining({ containerPath: '/workspace/global' }),
    );
  });

  it('appends only validated additional mounts at the end', () => {
    const validatedMounts: VolumeMount[] = [
      {
        hostPath: '/allowed/read-only',
        containerPath: '/workspace/extra/read-only',
        readonly: true,
      },
      {
        hostPath: '/allowed/read-write',
        containerPath: '/workspace/extra/read-write',
        readonly: false,
      },
    ];
    const rawMount: VolumeMount = {
      hostPath: '/raw/config',
      containerPath: 'raw-config',
      readonly: false,
    };
    const input = {
      ...baseInput({ validatedAdditionalMounts: validatedMounts }),
      additionalMounts: [rawMount],
    } as ContainerRunSpecInput & { additionalMounts: VolumeMount[] };

    const spec = buildContainerRunSpec(input);

    expect(spec.mounts.slice(-2)).toEqual(validatedMounts);
    expect(spec.mounts).not.toContainEqual(rawMount);
  });
});

describe('buildContainerRunSpec args and env', () => {
  it('mirrors API-key and OAuth auth modes with exact placeholder env', () => {
    const apiKeySpec = buildContainerRunSpec(
      baseInput({ runtime: { authMode: 'api-key' } }),
    );
    const oauthSpec = buildContainerRunSpec(
      baseInput({ runtime: { authMode: 'oauth' } }),
    );

    expect(apiKeySpec.env).toEqual([
      { name: 'TZ', value: 'America/Los_Angeles' },
      {
        name: 'ANTHROPIC_BASE_URL',
        value: 'http://host.docker.internal:3001',
      },
      { name: 'ANTHROPIC_API_KEY', value: 'placeholder' },
    ]);
    expect(apiKeySpec.args).toContain('ANTHROPIC_API_KEY=placeholder');
    expect(apiKeySpec.args).not.toContain(
      'CLAUDE_CODE_OAUTH_TOKEN=placeholder',
    );

    expect(oauthSpec.env).toEqual([
      { name: 'TZ', value: 'America/Los_Angeles' },
      {
        name: 'ANTHROPIC_BASE_URL',
        value: 'http://host.docker.internal:3001',
      },
      { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'placeholder' },
    ]);
    expect(oauthSpec.args).toContain('CLAUDE_CODE_OAUTH_TOKEN=placeholder');
    expect(oauthSpec.args).not.toContain('ANTHROPIC_API_KEY=placeholder');
  });

  it('builds exact mount args with readonly flags and image last', () => {
    const spec = buildContainerRunSpec(
      baseInput({
        isMain: true,
        runtime: {
          hostGatewayArgs: ['--add-host=host.docker.internal:host-gateway'],
        },
        validatedAdditionalMounts: [
          {
            hostPath: '/allowed/read-only',
            containerPath: '/workspace/extra/read-only',
            readonly: true,
          },
          {
            hostPath: '/allowed/read-write',
            containerPath: '/workspace/extra/read-write',
            readonly: false,
          },
        ],
      }),
    );

    expect(spec.args).toEqual([
      'run',
      '-i',
      '--rm',
      '--name',
      'nanoclaw-test-group-123',
      '-e',
      'TZ=America/Los_Angeles',
      '-e',
      'ANTHROPIC_BASE_URL=http://host.docker.internal:3001',
      '-e',
      'ANTHROPIC_API_KEY=placeholder',
      '--add-host=host.docker.internal:host-gateway',
      '-v',
      '/repo/nanoclaw:/workspace/project:ro',
      '-v',
      '/data/groups/test-group:/workspace/group',
      '-v',
      '/data/sessions/test-group/.claude:/home/node/.claude',
      '-v',
      '/data/ipc/test-group:/workspace/ipc',
      '-v',
      '/data/sessions/test-group/agent-runner-src:/app/src',
      '-v',
      '/allowed/read-only:/workspace/extra/read-only:ro',
      '-v',
      '/allowed/read-write:/workspace/extra/read-write',
      'nanoclaw-agent:latest',
    ]);
    expect(spec.args[spec.args.length - 1]).toBe('nanoclaw-agent:latest');
  });

  it('adds --user and HOME only for non-root non-node host uid', () => {
    const withoutUid = buildContainerRunSpec(
      baseInput({
        facts: { projectEnvFileExists: false, globalDirExists: false },
      }),
    );
    const root = buildContainerRunSpec(
      baseInput({
        facts: {
          projectEnvFileExists: false,
          globalDirExists: false,
          hostUid: 0,
        },
      }),
    );
    const nodeUser = buildContainerRunSpec(
      baseInput({
        facts: {
          projectEnvFileExists: false,
          globalDirExists: false,
          hostUid: 1000,
        },
      }),
    );
    const hostUser = buildContainerRunSpec(
      baseInput({
        facts: {
          projectEnvFileExists: false,
          globalDirExists: false,
          hostUid: 501,
          hostGid: 20,
        },
      }),
    );

    for (const spec of [withoutUid, root, nodeUser]) {
      expect(spec.args).not.toContain('--user');
      expect(spec.args).not.toContain('HOME=/home/node');
      expect(spec.env).not.toContainEqual({
        name: 'HOME',
        value: '/home/node',
      });
    }

    expect(hostUser.args).toContain('--user');
    expect(hostUser.args).toContain('501:20');
    expect(hostUser.args).toContain('HOME=/home/node');
    expect(hostUser.env).toContainEqual({ name: 'HOME', value: '/home/node' });
  });
});

describe('buildContainerName', () => {
  it('preserves container name sanitization', () => {
    expect(buildContainerName('Main Group/with_symbols!', 12345)).toBe(
      'nanoclaw-Main-Group-with-symbols--12345',
    );
  });
});
