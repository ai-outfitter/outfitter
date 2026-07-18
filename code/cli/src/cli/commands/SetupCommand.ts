// Provides `outfitter setup` — interactive onboarding that writes a starter `.agents` config.
import { createInterface } from 'node:readline/promises';

import { Command } from 'commander';

import type { SelectOption, SetupPrompter, SetupResult } from '../../setup/Setup.js';
import { executeSetup } from '../../setup/Setup.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory } from './ProcessDefaults.js';

export interface SetupCommandDependencies {
  readonly homeDirectory?: string;
  readonly prompter?: SetupPrompter;
  readonly writeLine?: (message: string) => void;
}

/* v8 ignore start -- readline prompting needs a real TTY; the SetupPrompter contract is unit-tested. */
export const createReadlinePrompter = (): SetupPrompter => {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  const ask = async (query: string): Promise<string> => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return (await rl.question(query)).trim();
    } finally {
      rl.close();
    }
  };

  return {
    interactive,
    async select(question: string, options: readonly SelectOption[], defaultValue: string): Promise<string> {
      // Without a TTY, readline.question never resolves on EOF; take the default instead of hanging.
      if (!interactive) {
        return defaultValue;
      }

      const lines = options.map((option, index) => `  ${index + 1}) ${option.label}`).join('\n');
      const answer = await ask(`${question}\n${lines}\n[${defaultValue}] > `);

      if (answer === '') {
        return defaultValue;
      }

      const byIndex = options[Number(answer) - 1];
      return byIndex?.value ?? options.find((option) => option.value === answer)?.value ?? defaultValue;
    },
    async input(question: string, defaultValue: string): Promise<string> {
      if (!interactive) {
        return defaultValue;
      }

      const answer = await ask(`${question} [${defaultValue}] > `);
      return answer === '' ? defaultValue : answer;
    },
  };
};
/* v8 ignore stop */

/** Runs onboarding as a standalone command; shares {@link executeSetup} with the implicit run trigger. */
export const runSetup = (dependencies: SetupCommandDependencies): Promise<SetupResult> =>
  executeSetup({
    homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
    /* v8 ignore next -- the injected prompter is used in tests; readline is the real-CLI default. */
    prompter: dependencies.prompter ?? createReadlinePrompter(),
  });

export const createSetupCommand = (dependencies: SetupCommandDependencies = {}): CommandObject => ({
  name: 'setup',
  description: 'Interactively create ~/.agents (default agent and harness).',
  register(program: Command): void {
    program.addCommand(
      new Command('setup')
        .description('Interactively create ~/.agents (default agent and harness).')
        .action(async () => {
          const result = await runSetup(dependencies);

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
        }),
    );
  },
});
