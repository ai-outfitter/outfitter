// Provides `outfitter dump --agent <id> --out <dir>` over the effective resource set.

import { Command } from 'commander';

import { dumpAgent } from '../../dump/Dump.js';
import { dumpWorkflow } from '../../dump/WorkflowDump.js';
import { strictAmbiguityFailureMessage } from '../../resolver/AmbiguityWarnings.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { Settings } from '../../settings/Settings.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface DumpInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly agent?: string;
  readonly workflow?: string;
  readonly out: string;
  readonly strict?: boolean;
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

const resolveAgentSlug = (settings: Settings, requested: string | undefined): string => {
  if (requested !== undefined) {
    return requested;
  }

  if (settings.defaultAgent === undefined) {
    throw new Error("No agent selected and no 'default_agent' in settings. Pass --agent <id>.");
  }

  return settings.defaultAgent;
};

export const executeDumpCommand = (input: DumpInput): DumpCommandResult => {
  const { set, settings, settingsIssues, warnings, ambiguityWarnings } = resolveEffectiveSet(input);

  if (settingsIssues.length > 0) {
    throw new Error(`Cannot dump with invalid settings: ${settingsIssues.map((issue) => issue.message).join('; ')}`);
  }

  const syncWarnings = warnings.map((warning) => `warning: ${warning}`);

  if (input.strict === true && ambiguityWarnings.length > 0) {
    return {
      writtenPaths: [],
      messages: [...syncWarnings, `error: ${strictAmbiguityFailureMessage}`],
      ok: false,
    };
  }

  if (input.agent !== undefined && input.workflow !== undefined) throw new Error('Choose either --agent or --workflow, not both.');
  const selected = input.workflow ?? resolveAgentSlug(settings, input.agent);
  const result = input.workflow === undefined
    ? dumpAgent(set, selected, input.out, input.projectDirectory)
    : dumpWorkflow(set, selected, input.out, input.projectDirectory);
  const ok = result.errors.length === 0;
  const messages = ok
    ? [
        ...syncWarnings,
        `Dumped '${selected}' to ${input.out} (${result.writtenPaths.length} files).`,
        ...result.warnings,
      ]
    : [...syncWarnings, ...result.errors, ...result.warnings];

  return { writtenPaths: result.writtenPaths, messages, ok };
};

export const createDumpCommand = (dependencies: DumpCommandDependencies = {}): CommandObject => ({
  name: 'dump',
  description: 'Write the composed .agents tree for an agent or workflow to a directory.',
  register(program: Command): void {
    program.addCommand(
      new Command('dump')
        .description('Write the composed .agents tree for an agent or workflow to a directory.')
        .option('--agent <id>', 'Agent slug to dump (default: settings default_agent).')
        .option('--workflow <id>', 'Workflow slug whose complete non-executable closure should be dumped.')
        .option('--out <dir>', 'Output directory.', './outfitter-dump')
        .option('--strict', 'Treat ambiguous source resolution as fatal.')
        .action((options: { agent?: string; workflow?: string; out: string; strict?: boolean }) => {
          const result = executeDumpCommand({
            /* v8 ignore next 2 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
            homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
            projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
            agent: options.agent,
            workflow: options.workflow,
            out: options.out,
            strict: options.strict,
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
