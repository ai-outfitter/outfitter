import { Command } from 'commander';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory } from './ProcessDefaults.js';
import { experimentalProviderEnabled, providerOptInMessage } from '../../hosted/ExperimentalProvider.js';
import type { HostedSession } from '../../hosted/HostedSession.js';

export interface HostedCommandDependencies {
  session?: () => HostedSession | Promise<HostedSession>;
  enabled?: () => boolean;
  writeLine?: (line: string) => void;
}

export const createHostedCommand = (dependencies: HostedCommandDependencies = {}): CommandObject => ({
  name: 'login',
  description: 'Internal Outfitter inference access.',
  register(program: Command): void {
    const enabled = dependencies.enabled ?? (() => experimentalProviderEnabled(resolveHomeDirectory()));
    const session =
      dependencies.session ??
      (async () => {
        const { createHostedSession } = await import('../../hosted/HostedSession.js');
        return createHostedSession(resolveHomeDirectory());
      });
    const write = dependencies.writeLine ?? console.log;
    program.addCommand(
      new Command('login')
        .description('Sign in to Outfitter internal beta.')
        .option('--device-code', 'Use a device code without opening a browser.')
        .action(async (options: { deviceCode?: boolean }) => {
          if (!enabled()) throw new Error(providerOptInMessage);
          const identity = await (
            await session()
          ).login({
            onDeviceCode: ({ verificationUri, userCode }) => write(`Open ${verificationUri} and enter ${userCode}`),
            onAuth: ({ url }) => write(`Open ${url}`),
            onPrompt: () => Promise.reject(new Error('Outfitter uses browser device approval.')),
            onSelect: () => Promise.resolve(options.deviceCode ? 'device-code' : 'browser'),
            onProgress: write,
          });
          write(`Signed in to Outfitter internal beta as ${identity.user.login}.`);
        }),
      { hidden: !enabled() },
    );
    program.addCommand(
      new Command('logout').description('Revoke the Outfitter internal beta session.').action(async () => {
        await (await session()).logout();
        write('Signed out of Outfitter.');
      }),
      { hidden: !enabled() },
    );
  },
});
