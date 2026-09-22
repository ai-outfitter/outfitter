import { Command } from 'commander';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory } from './ProcessDefaults.js';
import type { HostedSession } from '../../hosted/HostedSession.js';

export interface HostedCommandDependencies {
  session?: () => HostedSession | Promise<HostedSession>;
  writeLine?: (line: string) => void;
}

export const createHostedCommand = (dependencies: HostedCommandDependencies = {}): CommandObject => ({
  name: 'login',
  description: 'Manage Outfitter hosted inference access.',
  register(program: Command): void {
    const session =
      dependencies.session ??
      (async () => {
        const { createHostedSession } = await import('../../hosted/HostedSession.js');
        return createHostedSession(resolveHomeDirectory(), process.env);
      });
    const write = dependencies.writeLine ?? console.log;
    const output = (value: unknown) => write(JSON.stringify(value, null, 2));
    program.addCommand(
      new Command('login').description('Sign in to Outfitter using browser approval.').action(async () => {
        const identity = await (
          await session()
        ).login({
          onDeviceCode: ({ verificationUri, userCode }) => write(`Open ${verificationUri} and enter ${userCode}`),
          onAuth: ({ url }) => write(`Open ${url}`),
          onPrompt: () => Promise.reject(new Error('Outfitter uses browser device approval.')),
          onSelect: () => Promise.resolve(undefined),
        });
        output(identity);
      }),
    );
    program.addCommand(
      new Command('logout').description('Revoke the current Outfitter device session.').action(async () => {
        await (await session()).logout();
        write('Signed out of Outfitter.');
      }),
    );
    program.addCommand(
      new Command('account')
        .description('Show the current user and available workspaces.')
        .action(async () => output(await (await session()).identity())),
    );
    program.addCommand(
      new Command('workspace')
        .description('Select the workspace charged for inference.')
        .argument('<id>', 'Workspace ID from outfitter account.')
        .action(async (id: string) => output(await (await session()).workspace(id))),
    );
    program.addCommand(
      new Command('usage')
        .description('Show balance and usage for the selected workspace.')
        .action(async () => output(await (await session()).usage())),
    );
  },
});
