// Materializes portable hook snapshots and translates the stop event through native harness
// mechanisms. Hook packages run as argv, without a shell, from the active workspace.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CompositionPlan } from '../composer/Composition.js';
import type { AgentLaunchPlan, ProjectionInput } from '../projection/Projection.js';
import type { WorkspaceHooksSnapshot } from './WorkspaceHook.js';

export interface WorkspaceHookProjection {
  readonly launch: AgentLaunchPlan;
  readonly warnings: readonly string[];
}

const runtimeDirectoryName = '.outfitter/workspace-hooks';

const dispatcherSource = (snapshot: WorkspaceHooksSnapshot, packageRoot: string): string => {
  const hooks = snapshot.hooks.flatMap((hook) => {
    const command = hook.events.stop;
    return command === undefined
      ? []
      : [
          {
            slug: hook.slug,
            name: hook.name,
            command: join(packageRoot, hook.slug, ...command.command.split('/')),
            args: command.args,
            timeoutMilliseconds: command.timeoutSeconds * 1000,
          },
        ];
  });
  const configuration = JSON.stringify({ workspace: snapshot.workspaceDirectory, hooks });

  return `#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const configuration = ${configuration};
const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const harness = option('--harness');
const event = option('--event');
let nativeEvent = {};
try {
  const input = option('--native-event-json') ?? readFileSync(0, 'utf8');
  nativeEvent = input.trim() === '' ? {} : JSON.parse(input);
} catch (error) {
  process.stderr.write('Warning: workspace hook dispatcher received invalid native event JSON: ' + String(error) + '\\n');
}
const continuationActive = nativeEvent.stop_hook_active === true || option('--continuation-active') === 'true';
const continuationSupported = harness === 'claude' || harness === 'pi';
const reasons = [];

for (const hook of configuration.hooks) {
  const payload = {
    version: 1,
    event,
    harness,
    workspace: configuration.workspace,
    hook: { slug: hook.slug, name: hook.name },
    continuation: { active: continuationActive, supported: continuationSupported },
  };
  const result = spawnSync(hook.command, hook.args, {
    cwd: configuration.workspace,
    input: JSON.stringify(payload) + '\\n',
    encoding: 'utf8',
    shell: false,
    timeout: hook.timeoutMilliseconds,
    maxBuffer: 1024 * 1024,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\\n').trim();
  if (result.status === 2) {
    if (harness === 'claude' && continuationActive) {
      process.stderr.write("Warning: workspace hook '" + hook.slug + "' requested continuation while a Claude stop-hook continuation is active; stopping to prevent a loop.\\n");
      if (output !== '') process.stderr.write(output + '\\n');
    } else {
      reasons.push("Workspace hook '" + hook.slug + "' requested continuation" + (output === '' ? '.' : ':\\n' + output));
    }
  } else if (result.status !== 0) {
    const detail = result.error ? String(result.error) : result.signal ? 'signal ' + result.signal : 'exit ' + String(result.status);
    process.stderr.write("Warning: workspace hook '" + hook.slug + "' failed (" + detail + "); continuing the session.\\n");
    if (output !== '') process.stderr.write(output + '\\n');
  }
}

if (reasons.length > 0) {
  process.stderr.write(reasons.join('\\n\\n') + '\\n');
  process.exit(2);
}
`;
};

const writeSnapshot = (snapshot: WorkspaceHooksSnapshot, rootDirectory: string): string => {
  const runtimeRoot = join(rootDirectory, ...runtimeDirectoryName.split('/'));
  const packageRoot = join(runtimeRoot, 'packages');
  for (const hook of snapshot.hooks) {
    for (const file of hook.files) {
      const target = join(packageRoot, hook.slug, ...file.path.split('/'));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { mode: file.mode });
      chmodSync(target, file.mode);
    }
  }
  const dispatcherPath = join(runtimeRoot, 'dispatcher.mjs');
  mkdirSync(dirname(dispatcherPath), { recursive: true });
  writeFileSync(dispatcherPath, dispatcherSource(snapshot, packageRoot), { mode: 0o755 });
  return dispatcherPath;
};

const stopTimeoutSeconds = (snapshot: WorkspaceHooksSnapshot): number =>
  snapshot.hooks.reduce((sum, hook) => sum + (hook.events.stop?.timeoutSeconds ?? 0), 0) + 5;

const claudeHookDocument = (command: string, timeout: number): Record<string, unknown> => ({
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command, timeout }] }],
  },
});

const objectValue = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const arrayValue = (value: unknown): readonly unknown[] => (Array.isArray(value) ? (value as readonly unknown[]) : []);

const mergeClaudeIsolatedSettings = (rootDirectory: string, portable: Record<string, unknown>): void => {
  const settingsPath = join(rootDirectory, 'settings.json');
  let settings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed))
      settings = parsed as Record<string, unknown>;
  } catch {
    // The projection owns this file. An absent file starts with an empty object.
  }
  const existingHooks = objectValue(settings.hooks);
  const portableHooks = objectValue(portable.hooks);
  const existingStop = arrayValue(existingHooks.Stop);
  const portableStop = arrayValue(portableHooks.Stop);
  writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        ...settings,
        hooks: { ...existingHooks, ...portableHooks, Stop: [...existingStop, ...portableStop] },
      },
      null,
      2,
    )}\n`,
  );
};

const projectClaude = (
  snapshot: WorkspaceHooksSnapshot,
  input: ProjectionInput,
  dispatcherPath: string,
  launch: AgentLaunchPlan,
): WorkspaceHookProjection => {
  const inherited = input.isolation !== 'isolated';
  const target = inherited ? '$CLAUDE_PLUGIN_ROOT/.outfitter/workspace-hooks/dispatcher.mjs' : dispatcherPath;
  const command = `node "${target.replaceAll('"', '\\"')}" --harness claude --event stop`;
  const document = claudeHookDocument(command, stopTimeoutSeconds(snapshot));
  if (inherited) {
    const hooksPath = join(input.rootDirectory, 'hooks', 'hooks.json');
    mkdirSync(dirname(hooksPath), { recursive: true });
    writeFileSync(hooksPath, `${JSON.stringify(document, null, 2)}\n`);
  } else {
    mergeClaudeIsolatedSettings(input.rootDirectory, document);
  }
  return { launch, warnings: [] };
};

const piExtensionSource = (dispatcherPath: string): string => `
const DISPATCHER = ${JSON.stringify(dispatcherPath)};
let continuationActive = false;

export default function outfitterWorkspaceHooks(pi) {
  pi.on('agent_end', async () => {
    const result = await pi.exec(process.execPath, [
      DISPATCHER,
      '--harness', 'pi',
      '--event', 'stop',
      '--continuation-active', String(continuationActive),
      '--native-event-json', '{}',
    ]);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.code !== 2) {
      continuationActive = false;
      if (result.code !== 0) {
        process.stderr.write('Warning: workspace hook dispatcher failed; continuing the session.\\n');
      }
      return;
    }
    if (continuationActive) {
      continuationActive = false;
      process.stderr.write('Warning: a workspace stop hook requested continuation twice; stopping to prevent a loop.\\n');
      return;
    }
    continuationActive = true;
    const reason = (result.stderr || result.stdout || 'A workspace hook requested more work.').trim();
    pi.sendUserMessage(reason, { deliverAs: 'followUp' });
  });
}
`;

const projectPi = (
  input: ProjectionInput,
  dispatcherPath: string,
  launch: AgentLaunchPlan,
): WorkspaceHookProjection => {
  const extensionPath = join(input.rootDirectory, ...runtimeDirectoryName.split('/'), 'pi-extension.js');
  writeFileSync(extensionPath, piExtensionSource(dispatcherPath));
  return { launch: { ...launch, args: ['--extension', extensionPath, ...launch.args] }, warnings: [] };
};

/** Projects portable hooks without changing durable native harness configuration. */
export const projectWorkspaceHooks = (
  composition: CompositionPlan,
  input: ProjectionInput,
  launch: AgentLaunchPlan,
): WorkspaceHookProjection => {
  const snapshot = composition.workspaceHooks;
  if (snapshot === undefined || snapshot.hooks.length === 0) return { launch, warnings: [] };
  const dispatcherPath = writeSnapshot(snapshot, input.rootDirectory);

  switch (input.harness) {
    case 'claude':
      return projectClaude(snapshot, input, dispatcherPath, launch);
    case 'pi':
      return projectPi(input, dispatcherPath, launch);
    case 'codex':
      return {
        launch,
        warnings: [
          'codex adapter cannot safely project workspace stop hooks: Codex has no alternate project hook-file flag for the temporary runtime, session hooks need trust for the changing dispatcher path, and notify hooks cannot request continuation. No workspace hooks were attached.',
        ],
      };
  }
};
