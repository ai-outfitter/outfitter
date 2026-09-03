// Provides `outfitter link`, which projects the composed tree into Claude Code and Codex homes as managed links.

import { Command } from 'commander';

import { detectInstalledHarnesses, isLinkHarness, linkHarnesses, resolveHarnessHome } from '../../links/HarnessHome.js';
import type { LinkHarness } from '../../links/HarnessHome.js';
import { applyHarnessLinks, removeHarnessLinks, spawnHarnessCommand } from '../../links/HarnessLinkApply.js';
import type { HarnessCommandRunner, LinkAction } from '../../links/HarnessLinkApply.js';
import { composeLinkClosure, planHarnessLinks, resolveLinkScope } from '../../links/HarnessLinkPlan.js';
import type { LinkClosure } from '../../links/HarnessLinkPlan.js';
import { strictAmbiguityFailureMessage } from '../../resolver/AmbiguityWarnings.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import { formatSettingsIssue } from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface LinkInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly harnesses: readonly string[];
  readonly agents: readonly string[];
  readonly workflows: readonly string[];
  readonly all?: boolean;
  readonly dryRun?: boolean;
  readonly remove?: boolean;
  readonly strict?: boolean;
}

export interface LinkResult {
  readonly exitCode: number;
  readonly messages: readonly string[];
}

export interface LinkCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly runHarnessCommand?: HarnessCommandRunner;
  readonly writeLine?: (message: string) => void;
}

const failure = (messages: readonly string[]): LinkResult => ({ exitCode: 1, messages });

const selectHarnesses = (input: LinkInput): readonly LinkHarness[] | string => {
  if (input.harnesses.length === 0) {
    const detected = detectInstalledHarnesses(input.homeDirectory, input.env);
    return detected.length > 0
      ? detected
      : `No harness home found. Pass --harness <${linkHarnesses.join('|')}> to create one.`;
  }
  const unknown = input.harnesses.find((harness) => !isLinkHarness(harness));
  return unknown === undefined
    ? [...new Set(input.harnesses as LinkHarness[])]
    : `Unknown harness '${unknown}'. link supports: ${linkHarnesses.join(', ')}.`;
};

const describe = (harness: LinkHarness, action: LinkAction, dryRun: boolean): string => {
  const verb =
    dryRun && (action.status === 'created' || action.status === 'updated' || action.status === 'pruned')
      ? `would ${action.status.replace(/d$/, '')}`
      : action.status;
  const target = action.entry.kind === 'symlink' ? ` -> ${action.entry.target}` : '';
  const detail = action.detail === undefined ? '' : ` (${action.detail})`;
  return `${harness}: ${verb} ${action.entry.path}${target}${detail}`;
};

const summary = (harness: LinkHarness, home: string, actions: readonly LinkAction[]): string => {
  const counts = new Map<string, number>();
  for (const action of actions) counts.set(action.status, (counts.get(action.status) ?? 0) + 1);
  const parts = [...counts.entries()].map(([status, count]) => `${count} ${status}`);
  return `${harness} (${home}): ${parts.length === 0 ? 'nothing to do' : parts.join(', ')}`;
};

const removeLinks = (input: LinkInput, harnesses: readonly LinkHarness[], run: HarnessCommandRunner): LinkResult => {
  const messages: string[] = [];
  for (const harness of harnesses) {
    const home = resolveHarnessHome(harness, input.homeDirectory, input.env);
    const { actions } = removeHarnessLinks(harness, home, run);
    messages.push(...actions.map((action) => describe(harness, action, false)), summary(harness, home, actions));
  }
  return { exitCode: 0, messages };
};

const hasConflicts = (actions: readonly LinkAction[]): boolean =>
  actions.some((action) => action.status === 'conflict' || action.status === 'skipped');

interface ResolvedClosure {
  readonly closure?: LinkClosure;
  readonly failure?: LinkResult;
}

const resolveClosure = (input: LinkInput, messages: string[]): ResolvedClosure => {
  const { set, settings, settingsIssues, warnings, ambiguityWarnings } = resolveEffectiveSet(input);
  if (settingsIssues.length > 0) {
    throw new Error(`Cannot link with invalid settings: ${settingsIssues.map(formatSettingsIssue).join('; ')}`);
  }
  messages.push(...warnings.map((warning) => `warning: ${warning}`));
  if (input.strict === true && ambiguityWarnings.length > 0) {
    return { failure: failure([...messages, `error: ${strictAmbiguityFailureMessage}`]) };
  }

  const scope = resolveLinkScope(set, settings, {
    agents: input.agents,
    workflows: input.workflows,
    all: input.all === true,
  });
  if (scope.errors.length > 0)
    return { failure: failure([...messages, ...scope.errors.map((error) => `error: ${error}`)]) };
  const closure = composeLinkClosure(set, scope.agents, input.projectDirectory, settings.agentDefaults);
  messages.push(...closure.warnings.map((warning) => `warning: ${warning}`));
  if (closure.errors.length > 0) {
    return { failure: failure([...messages, ...closure.errors.map((error) => `error: ${error}`)]) };
  }
  return { closure };
};

const linkHarness = (
  input: LinkInput,
  closure: LinkClosure,
  harness: LinkHarness,
  run: HarnessCommandRunner,
  messages: string[],
): boolean => {
  const dryRun = input.dryRun === true;
  const plan = planHarnessLinks(closure, harness);
  messages.push(...plan.warnings.map((warning) => `warning: ${warning}`));
  const home = resolveHarnessHome(harness, input.homeDirectory, input.env);
  const { actions } = applyHarnessLinks(plan, home, { dryRun }, run);
  messages.push(...actions.map((action) => describe(harness, action, dryRun)), summary(harness, home, actions));
  return plan.warnings.length > 0 || hasConflicts(actions);
};

const linkAll = (input: LinkInput, harnesses: readonly LinkHarness[], run: HarnessCommandRunner): LinkResult => {
  const messages: string[] = [];
  const resolved = resolveClosure(input, messages);
  if (resolved.closure === undefined) return resolved.failure!;
  let attention = resolved.closure.warnings.length > 0;
  for (const harness of harnesses)
    attention = linkHarness(input, resolved.closure, harness, run, messages) || attention;
  return { exitCode: input.strict === true && attention ? 1 : 0, messages };
};

export const executeLinkCommand = (input: LinkInput, run: HarnessCommandRunner = spawnHarnessCommand): LinkResult => {
  const harnesses = selectHarnesses(input);
  if (typeof harnesses === 'string') return failure([`error: ${harnesses}`]);
  if (input.remove === true) return removeLinks(input, harnesses, run);
  return linkAll(input, harnesses, run);
};

const collect = (value: string, previous: readonly string[]): readonly string[] => [...previous, value];

interface LinkOptions {
  readonly harness: readonly string[];
  readonly agent: readonly string[];
  readonly workflow: readonly string[];
  readonly all?: boolean;
  readonly dryRun?: boolean;
  readonly remove?: boolean;
  readonly strict?: boolean;
}

export const createLinkCommand = (dependencies: LinkCommandDependencies = {}): CommandObject => ({
  name: 'link',
  description:
    'Link composed skills, agents, prompts, shared context, and MCP servers into Claude Code and Codex homes.',
  register(program: Command): void {
    program.addCommand(
      new Command('link')
        .description(
          'Link composed skills, agents, prompts, shared context, and MCP servers into Claude Code and Codex homes.',
        )
        .option(
          '--harness <name>',
          'Harness home to link into: claude or codex (repeatable; default: every installed one).',
          collect,
          [],
        )
        .option('--agent <id>', 'Agent whose closure to link (repeatable).', collect, [])
        .option('--workflow <id>', 'Enabled workflow whose agent closures to link (repeatable).', collect, [])
        .option('--all', 'Link every resolvable agent, skill, and command.')
        .option('--dry-run', 'Report what would change without touching the harness home.')
        .option('--remove', 'Remove every link this command created and forget them.')
        .option('--strict', 'Exit non-zero on warnings, conflicts, or skipped entries.')
        .action((options: LinkOptions) => {
          const result = executeLinkCommand(
            {
              /* v8 ignore next 3 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
              homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
              projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
              env: dependencies.env ?? process.env,
              harnesses: options.harness,
              agents: options.agent,
              workflows: options.workflow,
              all: options.all,
              dryRun: options.dryRun,
              remove: options.remove,
              strict: options.strict,
            },
            /* v8 ignore next -- the spawning runner is direct CLI behavior; tests inject a runner. */
            dependencies.runHarnessCommand ?? spawnHarnessCommand,
          );

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }

          if (result.exitCode !== 0) process.exitCode = result.exitCode;
        }),
    );
  },
});
