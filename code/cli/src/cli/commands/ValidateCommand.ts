// Provides `outfitter validate [--strict] [--json]` over the effective resource set.

import { Command } from 'commander';

import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { ValidationFinding } from '../../resolver/ResolverValidation.js';
import { validateEffectiveSet } from '../../resolver/ResolverValidation.js';
import { formatSettingsIssue } from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface ValidateInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly strict?: boolean;
  readonly json?: boolean;
}

export interface ValidateResult {
  readonly findings: readonly ValidationFinding[];
  readonly ok: boolean;
  readonly messages: readonly string[];
}

export interface ValidateCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

const settingsFindings = (messages: readonly string[]): readonly ValidationFinding[] =>
  messages.map((message) => ({ severity: 'error' as const, resource: 'settings', message }));

export const executeValidateCommand = (input: ValidateInput): ValidateResult => {
  const { set, settings, settingsIssues, warnings } = resolveEffectiveSet(input);
  const findings = [
    ...settingsFindings(settingsIssues.map(formatSettingsIssue)),
    ...warnings.map((message) => ({ severity: 'warning' as const, resource: 'settings', message })),
    ...validateEffectiveSet(set, input.projectDirectory, { workflowRoots: settings.workflows }),
  ];

  const hasErrors = findings.some((finding) => finding.severity === 'error');
  const hasWarnings = findings.some((finding) => finding.severity === 'warning');
  const ok = !hasErrors && !(input.strict === true && hasWarnings);

  const messages = input.json === true ? [JSON.stringify({ ok, findings }, null, 2)] : formatFindings(findings, ok);

  return { findings, ok, messages };
};

const formatFindings = (findings: readonly ValidationFinding[], ok: boolean): readonly string[] => {
  if (findings.length === 0) {
    return ['✓ No issues found.'];
  }

  const lines = findings.map(
    (finding) => `${finding.severity === 'error' ? '✗' : '⚠'} ${finding.resource}: ${finding.message}`,
  );

  return [...lines, ok ? '✓ Passed (warnings only).' : '✗ Validation failed.'];
};

export const createValidateCommand = (dependencies: ValidateCommandDependencies = {}): CommandObject => ({
  name: 'validate',
  description: 'Validate the resolved .agents tree: schemas, loadout slugs, and shadowing.',
  register(program: Command): void {
    program.addCommand(
      new Command('validate')
        .description('Validate the resolved .agents tree: schemas, loadout slugs, and shadowing.')
        .option('--strict', 'Treat warnings, including ambiguous source resolution, as failures.')
        .option('--json', 'Emit findings as JSON.')
        .action((options: { strict?: boolean; json?: boolean }) => {
          /* v8 ignore next 2 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
          const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
          const projectDirectory = resolveProjectDirectory(dependencies.projectDirectory);
          const result = executeValidateCommand({
            homeDirectory,
            projectDirectory,
            strict: options.strict,
            json: options.json,
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
