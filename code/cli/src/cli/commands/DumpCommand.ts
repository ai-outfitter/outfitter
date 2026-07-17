// Provides `outfitter dump --agent <id> --out <dir>` over the effective resource set.
import { homedir } from 'node:os';

import { Command } from 'commander';

import { dumpAgent } from '../../dump/Dump.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import { loadSettingsWithCachedRemoteSettings } from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';

export interface DumpInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly agent?: string;
  readonly out: string;
}

export interface DumpCommandResult {
  readonly writtenPaths: readonly string[];
  readonly messages: readonly string[];
  readonly ok: boolean;
}

export interface DumpCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

const resolveAgentSlug = (homeDirectory: string, projectDirectory: string, requested: string | undefined): string => {
  if (requested !== undefined) {
    return requested;
  }

  const { settings } = loadSettingsWithCachedRemoteSettings({ homeDirectory, projectDirectory });

  if (settings.defaultAgent === undefined) {
    throw new Error("No agent selected and no 'default_agent' in settings. Pass --agent <id>.");
  }

  return settings.defaultAgent;
};

export const executeDumpCommand = (input: DumpInput): DumpCommandResult => {
  const { set, settingsIssues } = resolveEffectiveSet(input);

  if (settingsIssues.length > 0) {
    throw new Error(`Cannot dump with invalid settings: ${settingsIssues.map((issue) => issue.message).join('; ')}`);
  }

  const agentSlug = resolveAgentSlug(input.homeDirectory, input.projectDirectory, input.agent);
  const result = dumpAgent(set, agentSlug, input.out);
  const ok = result.errors.length === 0;
  const messages = ok
    ? [`Dumped '${agentSlug}' to ${input.out} (${result.writtenPaths.length} files).`, ...result.warnings]
    : [...result.errors, ...result.warnings];

  return { writtenPaths: result.writtenPaths, messages, ok };
};

export const createDumpCommand = (dependencies: DumpCommandDependencies = {}): CommandObject => ({
  name: 'dump',
  description: 'Write the composed .agents tree for an agent to a directory.',
  register(program: Command): void {
    program.addCommand(
      new Command('dump')
        .description('Write the composed .agents tree for an agent to a directory.')
        .option('--agent <id>', 'Agent slug to dump (default: settings default_agent).')
        .option('--out <dir>', 'Output directory.', './outfitter-dump')
        .action((options: { agent?: string; out: string }) => {
          const result = executeDumpCommand({
            /* v8 ignore next 2 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            agent: options.agent,
            out: options.out,
          });

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }

          if (!result.ok) {
            process.exitCode = 1;
          }
        }),
    );
  },
});
