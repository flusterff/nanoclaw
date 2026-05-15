export interface VolumeMount {
  hostPath: string;
  containerPath: string;
  readonly: boolean;
}

export type ContainerAuthMode = 'api-key' | 'oauth';

export interface ContainerRunSpecInput {
  groupFolder: string;
  isMain: boolean;
  containerName: string;
  paths: {
    projectRoot: string;
    groupDir: string;
    globalDir: string;
    groupSessionsDir: string;
    groupIpcDir: string;
    groupAgentRunnerDir: string;
  };
  facts: {
    projectEnvFileExists: boolean;
    globalDirExists: boolean;
    hostUid?: number;
    hostGid?: number;
  };
  runtime: {
    command: string;
    image: string;
    timezone: string;
    credentialProxyHost: string;
    credentialProxyPort: number;
    authMode: ContainerAuthMode;
    hostGatewayArgs: string[];
  };
  validatedAdditionalMounts: VolumeMount[];
}

export interface ContainerRunSpec {
  command: string;
  args: string[];
  containerName: string;
  mounts: VolumeMount[];
  env: Array<{ name: string; value: string }>;
}

function mountArgs(mount: VolumeMount): string[] {
  if (mount.readonly) {
    return ['-v', `${mount.hostPath}:${mount.containerPath}:ro`];
  }
  return ['-v', `${mount.hostPath}:${mount.containerPath}`];
}

export function buildContainerName(groupFolder: string, nowMs: number): string {
  const safeName = groupFolder.replace(/[^a-zA-Z0-9-]/g, '-');
  return `nanoclaw-${safeName}-${nowMs}`;
}

export function buildContainerRunSpec(
  input: ContainerRunSpecInput,
): ContainerRunSpec {
  const mounts: VolumeMount[] = [];

  if (input.isMain) {
    // Main gets project source read-only; writable paths are mounted separately.
    mounts.push({
      hostPath: input.paths.projectRoot,
      containerPath: '/workspace/project',
      readonly: true,
    });

    // Shadow .env so project-root visibility never exposes host secrets.
    if (input.facts.projectEnvFileExists) {
      mounts.push({
        hostPath: '/dev/null',
        containerPath: '/workspace/project/.env',
        readonly: true,
      });
    }

    mounts.push({
      hostPath: input.paths.groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });
  } else {
    // Non-main groups never receive the project root or project .env shadow.
    mounts.push({
      hostPath: input.paths.groupDir,
      containerPath: '/workspace/group',
      readonly: false,
    });

    // Global memory is read-only and only present when the host directory exists.
    if (input.facts.globalDirExists) {
      mounts.push({
        hostPath: input.paths.globalDir,
        containerPath: '/workspace/global',
        readonly: true,
      });
    }
  }

  mounts.push(
    {
      hostPath: input.paths.groupSessionsDir,
      containerPath: '/home/node/.claude',
      readonly: false,
    },
    {
      hostPath: input.paths.groupIpcDir,
      containerPath: '/workspace/ipc',
      readonly: false,
    },
    {
      hostPath: input.paths.groupAgentRunnerDir,
      containerPath: '/app/src',
      readonly: false,
    },
    ...input.validatedAdditionalMounts,
  );

  const baseEnv = [
    { name: 'TZ', value: input.runtime.timezone },
    {
      name: 'ANTHROPIC_BASE_URL',
      value: `http://${input.runtime.credentialProxyHost}:${input.runtime.credentialProxyPort}`,
    },
    input.runtime.authMode === 'api-key'
      ? { name: 'ANTHROPIC_API_KEY', value: 'placeholder' }
      : { name: 'CLAUDE_CODE_OAUTH_TOKEN', value: 'placeholder' },
  ];

  const args: string[] = ['run', '-i', '--rm', '--name', input.containerName];
  for (const env of baseEnv) {
    args.push('-e', `${env.name}=${env.value}`);
  }

  args.push(...input.runtime.hostGatewayArgs);

  const homeEnv =
    input.facts.hostUid != null &&
    input.facts.hostUid !== 0 &&
    input.facts.hostUid !== 1000
      ? { name: 'HOME', value: '/home/node' }
      : null;

  if (homeEnv) {
    args.push('--user', `${input.facts.hostUid}:${input.facts.hostGid}`);
    args.push('-e', `${homeEnv.name}=${homeEnv.value}`);
  }

  for (const mount of mounts) {
    args.push(...mountArgs(mount));
  }

  args.push(input.runtime.image);

  return {
    command: input.runtime.command,
    args,
    containerName: input.containerName,
    mounts,
    env: homeEnv ? [...baseEnv, homeEnv] : baseEnv,
  };
}
