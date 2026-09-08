// Lists compiled state only; discovery must not fetch, resolve, compose, or modify native homes.
import { Command } from 'commander';

import { linkHarnesses } from '../../links/HarnessHome.js';
import { readCompiledRegistry } from '../../profiles/CompiledRegistry.js';
import type { CompiledRegistryInput } from '../../profiles/CompiledRegistry.js';
import { profileProjectionStatus } from '../../profiles/NativeProfiles.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface ProfilesCommandInput extends CompiledRegistryInput {
  readonly json?: boolean;
}

export interface ProfilesCommandResult {
  readonly exitCode: number;
  readonly messages: readonly string[];
}

export interface ProfilesCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly writeLine?: (line: string) => void;
}

export const executeProfilesCommand = (input: ProfilesCommandInput): ProfilesCommandResult => {
  const registry = readCompiledRegistry(input);
  const profiles = (registry?.profiles ?? []).map((profile) => ({
    agent: profile.agent,
    fingerprint: profile.fingerprint,
    harnesses: Object.fromEntries(linkHarnesses.map((harness) => [harness, profileProjectionStatus(profile, harness)])),
  }));
  return {
    exitCode: 0,
    messages:
      input.json === true
        ? [JSON.stringify({ version: 1, profiles })]
        : profiles.length === 0
          ? ["No compiled profiles. Run 'outfitter sync' after selecting a default agent or enabling a workflow."]
          : profiles.map(
              (profile) =>
                `${profile.agent} (${profile.fingerprint.slice(0, 12)}) ${linkHarnesses
                  .map((harness) => `${harness}:${profile.harnesses[harness].status}`)
                  .join(' ')}`,
            ),
  };
};

export const createProfilesCommand = (dependencies: ProfilesCommandDependencies = {}): CommandObject => ({
  name: 'profiles',
  description: 'List compiled profiles and native harness projection readiness.',
  register(program: Command): void {
    program.addCommand(
      new Command('profiles')
        .description('List compiled profiles and native harness projection readiness.')
        .option('--json', 'Emit a stable machine-readable profile inventory.')
        .action((options: { json?: boolean }) => {
          const result = executeProfilesCommand({
            homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
            projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
            env: dependencies.env,
            json: options.json,
          });
          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
        }),
    );
  },
});
