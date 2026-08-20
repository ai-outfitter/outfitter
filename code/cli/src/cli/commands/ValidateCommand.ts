// Provides `outfitter validate [--strict] [--json]` over the effective resource set.

import { Command, Option } from 'commander';

import { compose } from '../../composer/Composer.js';
import { listResources } from '../../resolver/Resource.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { ValidationFinding } from '../../resolver/ResolverValidation.js';
import { validateEffectiveSet } from '../../resolver/ResolverValidation.js';
import { formatSettingsIssue } from '../../settings/SettingsLoader.js';
import type { Harness } from '../../settings/Settings.js';
import { HARNESSES } from '../../settings/Settings.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface ValidateInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly strict?: boolean;
  readonly json?: boolean;
  readonly harness?: Harness;
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

const PI_MCP_ADAPTER = 'npm:pi-mcp-adapter';
const isPiMcpAdapter = (extension: string): boolean =>
  extension === PI_MCP_ADAPTER || extension.startsWith(`${PI_MCP_ADAPTER}@`);

const piMcpAdapterFindings = (set: ReturnType<typeof resolveEffectiveSet>['set']): readonly ValidationFinding[] =>
  listResources(set, 'agent').flatMap((agent) => {
    const composition = compose(set, agent.slug);
    if (composition.plan === undefined) return [];
    if (composition.plan.loadout.mcp.length === 0) return [];
    if (composition.plan.loadout.extensions.some(isPiMcpAdapter)) return [];
    return [
      {
        severity: 'warning' as const,
        resource: `agent:${agent.slug}`,
        message: `MCP servers are selected for Pi, but no MCP-capable extension is configured; add '${PI_MCP_ADAPTER}' to extensions.`,
      },
    ];
  });

export const executeValidateCommand = (input: ValidateInput): ValidateResult => {
  const { set, settings, settingsIssues, warnings } = resolveEffectiveSet(input);
  const harness = input.harness ?? settings.defaultHarness ?? 'pi';
  const findings = [
    ...settingsFindings(settingsIssues.map(formatSettingsIssue)),
    ...warnings.map((message) => ({ severity: 'warning' as const, resource: 'settings', message })),
    ...validateEffectiveSet(set, input.projectDirectory),
    ...(harness === 'pi' ? piMcpAdapterFindings(set) : []),
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
        .addOption(new Option('--harness <harness>', 'Target harness for adapter checks.').choices(HARNESSES))
        .action((options: { strict?: boolean; json?: boolean; harness?: Harness }) => {
          /* v8 ignore next 2 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
          const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
          const projectDirectory = resolveProjectDirectory(dependencies.projectDirectory);
          const result = executeValidateCommand({
            homeDirectory,
            projectDirectory,
            strict: options.strict,
            json: options.json,
            harness: options.harness,
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
