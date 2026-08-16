// Provides `outfitter validate [--strict] [--json]` over the effective resource set.

import { Command } from 'commander';

import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { ValidationFinding } from '../../resolver/ResolverValidation.js';
import { validateEffectiveSet, validationFinding } from '../../resolver/ResolverValidation.js';
import { formatSettingsIssue } from '../../settings/SettingsLoader.js';
import type { SettingsLoadIssue } from '../../settings/SettingsLoader.js';
import type { ResolutionWarningDetail } from '../../validation/ResolutionWarning.js';
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

const settingsFindings = (issues: readonly SettingsLoadIssue[]): readonly ValidationFinding[] =>
  issues.map((issue) =>
    validationFinding({
      phase: 'parse',
      code: 'settings-invalid',
      severity: 'error',
      resource: 'settings',
      sourcePath: issue.filePath,
      message: formatSettingsIssue(issue),
      remediation: 'Correct the settings file, then run validation again.',
    }),
  );

const settingsWarningFindings = (warnings: readonly ResolutionWarningDetail[]): readonly ValidationFinding[] =>
  warnings.map((warning) =>
    validationFinding({
      phase: 'resolve',
      code: 'settings-warning',
      severity: 'warning',
      resource: warning.resource,
      sourcePath: warning.sourcePath,
      message: warning.message,
      remediation: 'Run outfitter sync to update remote sources. Correct any invalid source configuration.',
    }),
  );

export const collectCommonValidationFindings = (
  resolved: ReturnType<typeof resolveEffectiveSet>,
  projectDirectory: string,
): readonly ValidationFinding[] => [
  ...settingsFindings(resolved.settingsIssues),
  ...settingsWarningFindings(resolved.warningDetails),
  ...validateEffectiveSet(resolved.set, projectDirectory),
];

export const executeValidateCommand = (input: ValidateInput): ValidateResult => {
  const findings = collectCommonValidationFindings(resolveEffectiveSet(input), input.projectDirectory);

  const hasErrors = findings.some((finding) => finding.severity === 'error');
  const hasWarnings = findings.some((finding) => finding.severity === 'warning');
  const ok = !hasErrors && !(input.strict === true && hasWarnings);

  const messages =
    input.json === true ? [JSON.stringify({ ok, findings }, null, 2)] : formatValidationFindings(findings, ok);

  return { findings, ok, messages };
};

export const formatValidationFindings = (findings: readonly ValidationFinding[], ok: boolean): readonly string[] => {
  if (findings.length === 0) {
    return ['✓ No issues found.'];
  }

  const lines = findings.map(
    (finding) =>
      `${finding.severity === 'error' ? '✗' : '⚠'} [${finding.code}] ${finding.resource}: ${finding.message} ` +
      `Source: ${finding.sourcePath}. Remediation: ${finding.remediation}`,
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
