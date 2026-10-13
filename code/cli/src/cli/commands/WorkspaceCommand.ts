import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { WorkspaceClient } from '../../hosted/WorkspaceClient.js';
import { connectWorkspace } from '../../hosted/WorkspaceBridge.js';
import { resolveHomeDirectory } from './ProcessDefaults.js';
import type { CommandObject } from './CommandObject.js';

export interface WorkspaceCommandDependencies {
  client?: () => WorkspaceClient | Promise<WorkspaceClient>;
  readInput?: () => string;
  print?: (value: unknown) => void;
  connect?: typeof connectWorkspace;
}
export const createWorkspaceCommand = (dependencies: WorkspaceCommandDependencies = {}): CommandObject => ({
  name: 'workspaces',
  description: 'Manage remote workspace execution.',
  register(program) {
    const root = new Command('workspaces').description('Manage workspaces (requires login --workspaces).');
    const client =
      dependencies.client ??
      (async () => {
        const { createHostedSession } = await import('../../hosted/HostedSession.js');
        return new WorkspaceClient(createHostedSession(resolveHomeDirectory()));
      });
    const request = async (id?: string, action = '', method = 'GET', payload?: unknown) => {
      const service = await client();
      return service.request(id ? service.workspace(id, action) : 'workspace-capabilities', method, payload);
    };
    const print = dependencies.print ?? ((value: unknown) => console.log(JSON.stringify(value)));
    const readInput = dependencies.readInput ?? (() => readFileSync(0, 'utf8'));
    root.command('capabilities').action(async () => print(await request()));
    root
      .command('create <id>')
      .option('--title <title>', 'Workspace title.', 'Panopticon')
      .action(async (id: string, options: { title: string }) =>
        print(await request(id, '', 'PUT', { title: options.title, runtime: 'panopticon' })),
      );
    root.command('inspect <id>').action(async (id: string) => print(await request(id)));
    root.command('session-status <id>').action(async (id: string) => print(await request(id, 'session')));
    root
      .command('session-transcript <id>')
      .action(async (id: string) => print(await request(id, 'session', 'POST', { operation: 'transcript' })));
    root
      .command('session <id>')
      .description('Send a session operation as JSON on stdin.')
      .action(async (id: string) => print(await request(id, 'session', 'POST', JSON.parse(readInput()))));
    for (const action of ['sleep', 'wake', 'expire'])
      root.command(`${action} <id>`).action(async (id: string) => print(await request(id, action, 'POST', {})));
    root
      .command('close <id>')
      .action(async (id: string) => print(await request(id, 'session', 'POST', { operation: 'close' })));
    for (const terminal of [false, true])
      root
        .command(`${terminal ? 'attach' : 'connect'} <id>`)
        .requiredOption('--installation <id>', 'Runner installation UUID.')
        .option('--service-url <url>', 'Loopback task service origin.')
        .option('--task-token-file <path>', 'Private task capability snapshot.')
        .action(async (id: string, options: { installation: string; serviceUrl?: string; taskTokenFile?: string }) => {
          const controller = new AbortController();
          const stop = () => controller.abort();
          process.once('SIGTERM', stop);
          process.once('SIGINT', stop);
          if (!terminal) {
            process.stdin.on('end', stop);
            process.stdin.resume();
          }
          const raw = process.stdin.isTTY && terminal;
          let rawSet = false;
          try {
            if (terminal) await wakeTerminal(await client(), id, controller.signal);
            if (raw) {
              process.stdin.setRawMode(true);
              rawSet = true;
            }
            const capability = options.taskTokenFile
              ? (JSON.parse(readFileSync(options.taskTokenFile, 'utf8')) as { task: string }).task
              : undefined;
            await (dependencies.connect ?? connectWorkspace)(await client(), {
              id,
              installation: options.installation,
              terminal,
              serviceURL: options.serviceUrl,
              capability,
              signal: controller.signal,
              output: (data) => process.stdout.write(data),
              ready: () => {
                if (!terminal) print({ connected: true });
              },
            });
          } finally {
            if (rawSet) process.stdin.setRawMode(false);
            process.off('SIGTERM', stop);
            process.off('SIGINT', stop);
            if (!terminal) {
              process.stdin.off('end', stop);
              process.stdin.pause();
            }
          }
        });
    program.addCommand(root);
  },
});

async function wakeTerminal(service: WorkspaceClient, id: string, signal: AbortSignal): Promise<void> {
  const view = (await service.request(service.workspace(id))) as { state: string };
  if (view.state === 'Sleeping') await service.request(service.workspace(id, 'wake'), 'POST', {});
  const deadline = Date.now() + 120000;
  while (true) {
    signal.throwIfAborted();
    const { state } = (await service.request(service.workspace(id))) as { state: string };
    if (state === 'Running') break;
    if (['Interrupted', 'Expired'].includes(state)) throw new Error('Workspace needs explicit recovery.');
    if (Date.now() > deadline) throw new Error('Workspace did not wake.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await service.request(service.workspace(id, 'session'), 'POST', { operation: 'resume' });
}
