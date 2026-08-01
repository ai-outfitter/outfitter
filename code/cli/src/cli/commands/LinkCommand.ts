// Provides `outfitter link [--dry-run] [--remove] [--harness <ids>] [--force] [--json]`.
//
// This is the persistent counterpart to `outfitter run`: it provisions the user's real harness
// config directories from the resolved `.agents` catalog and then exits, leaving no runtime
// lifecycle behind. The two paths deliberately share no state — #187 requires persistent
// installation to stay separate from the temporary projection `run` assembles and deletes.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { HarnessId } from '../../harness/HarnessLayout.js';
import { HARNESS_IDS, isHarnessId } from '../../harness/HarnessLayout.js';
import { applyLinkPlan } from '../../harness/LinkApply.js';
import type { LinkSource, LinkStep } from '../../harness/LinkPlan.js';
import { planLinks } from '../../harness/LinkPlan.js';
import { readManifest, removeManifest, resolveManifestPath, writeManifest } from '../../harness/LinkManifest.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import { listResources } from '../../resolver/Resource.js';
import type { SettingsLoadIssue } from '../../settings/SettingsLoader.js';
import { formatSettingsIssue } from '../../settings/SettingsLoader.js';
import { Command } from 'commander';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface LinkInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly harnesses?: readonly HarnessId[];
  readonly dryRun?: boolean;
  readonly remove?: boolean;
  readonly force?: boolean;
  readonly json?: boolean;
  readonly strict?: boolean;
}

export interface LinkResult {
  readonly ok: boolean;
  readonly messages: readonly string[];
  /**
   * Diagnostics that belong on stderr: unsupported adapter controls and conflicts. AGENTS.md
   * requires an adapter that cannot support a requested control to warn on stderr, and keeping them
   * off stdout is also what lets `--json` output stay machine-parseable.
   */
  readonly diagnostics: readonly string[];
}

/**
 * Catalog resources eligible for linking. Skills resolve to a directory (the resolver records the
 * SKILL.md inside it) and commands to a single file, matching how each harness expects to find them.
 */
export const collectLinkSources = (set: ReturnType<typeof resolveEffectiveSet>['set']): readonly LinkSource[] => [
  ...listResources(set, 'skill').map((resource) => ({
    kind: 'skills' as const,
    slug: resource.slug,
    path: dirname(resource.winner.path),
  })),
  ...listResources(set, 'command').map((resource) => ({
    kind: 'commands' as const,
    // Command slugs carry their file extension because the resolver keys them by relative path;
    // harness filenames are derived from the bare slug.
    slug: resource.slug.replace(/\.md$/u, ''),
    path: resource.winner.path,
  })),
];

/** `~/.agents/AGENTS.md` is the canonical global instruction file (#187). */
const resolveInstructionsPath = (homeDirectory: string): string | undefined => {
  const path = join(homeDirectory, '.agents', 'AGENTS.md');
  return existsSync(path) ? path : undefined;
};

const formatStep = (step: LinkStep): string => {
  const symbol = { create: '+', update: '~', remove: '-', unchanged: '=', conflict: '!' }[step.action];
  const detail = step.source === undefined ? '' : ` -> ${step.source}`;
  const reason = step.reason === undefined ? '' : `  (${step.reason})`;

  return `  ${symbol} [${step.harness}/${step.kind}] ${step.target}${detail}${reason}`;
};

/** Invalid settings stop the run before anything is planned; nothing is written either way. */
const settingsErrorResult = (settingsIssues: readonly SettingsLoadIssue[], json: boolean): LinkResult => {
  const errors = settingsIssues.map(formatSettingsIssue);

  return json
    ? { ok: false, messages: [JSON.stringify({ ok: false, errors }, null, 2)], diagnostics: [] }
    : { ok: false, messages: [], diagnostics: errors.map((error) => `✗ ${error}`) };
};

export const executeLinkCommand = (input: LinkInput): LinkResult => {
  const resolved = resolveEffectiveSet(input);
  const { set, settingsIssues, warnings } = resolved;

  if (settingsIssues.length > 0) return settingsErrorResult(settingsIssues, input.json === true);

  const manifestPath = resolveManifestPath(input.env, input.homeDirectory);
  const manifest = readManifest(manifestPath);
  /* v8 ignore next -- mergeSettingsStack always materializes the block; the fallback is type-level. */
  const settings = resolved.settings.harnesses ?? {};

  // An explicit --harness narrows whatever settings.yml selected, without editing settings.
  const scopedSettings = input.harnesses === undefined ? settings : { ...settings, link: input.harnesses };

  const plan = planLinks({
    homeDirectory: input.homeDirectory,
    settings: scopedSettings,
    sources: collectLinkSources(set),
    instructionsPath: resolveInstructionsPath(input.homeDirectory),
    manifest,
    force: input.force,
    remove: input.remove,
    harnessFilter: input.harnesses,
  });

  // A strict run that cannot support something the user asked for must have no side effects at all,
  // so the plan is validated before it is applied rather than after.
  const strictFailure = input.strict === true && plan.unsupported.length > 0;
  const applied = applyLinkPlan(plan, manifest, { dryRun: input.dryRun === true || strictFailure });
  const ok = applied.conflicts.length === 0 && !strictFailure;

  if (input.dryRun !== true && !strictFailure) persistManifest(manifestPath, input, applied);

  const diagnostics = formatDiagnostics(plan, applied, warnings, strictFailure);

  if (input.json === true) {
    return { ok, messages: [JSON.stringify({ ok, warnings, plan, applied: summary(applied) }, null, 2)], diagnostics };
  }

  return { ok, messages: formatMessages(input, plan, applied), diagnostics };
};

/**
 * Everything that belongs on stderr: sync guidance, unsupported adapter controls (AGENTS.md
 * requires these to warn on stderr), and the conflict summary.
 */
const formatDiagnostics = (
  plan: ReturnType<typeof planLinks>,
  applied: ReturnType<typeof applyLinkPlan>,
  warnings: readonly string[],
  strictFailure: boolean,
): readonly string[] => [
  ...warnings.map((warning) => `⚠ ${warning}`),
  ...plan.unsupported.map((message) => `⚠ ${message}`),
  ...(strictFailure ? ['✗ Unsupported resources requested under --strict. Nothing was written.'] : []),
  ...(applied.conflicts.length > 0
    ? ['✗ Conflicting paths were left untouched. Move them aside, or re-run with --force.']
    : []),
];

/**
 * Records what Outfitter still owns.
 *
 * `--remove` forgets the manifest only when every managed path was actually retired. A settings
 * document Outfitter could not parse keeps its marked hook entries, so its manifest entry is the
 * only record that they are there — discarding it would strand those entries with no supported way
 * to remove them.
 */
const persistManifest = (manifestPath: string, input: LinkInput, applied: ReturnType<typeof applyLinkPlan>): void => {
  if (input.remove !== true) {
    writeManifest(manifestPath, applied.manifest);
    return;
  }

  if (applied.manifest.entries.length === 0) removeManifest(manifestPath);
  else writeManifest(manifestPath, applied.manifest);
};

const summary = (applied: ReturnType<typeof applyLinkPlan>): Record<string, number> => ({
  created: applied.created,
  updated: applied.updated,
  removed: applied.removed,
  unchanged: applied.unchanged,
  conflicts: applied.conflicts.length,
});

const formatMessages = (
  input: LinkInput,
  plan: ReturnType<typeof planLinks>,
  applied: ReturnType<typeof applyLinkPlan>,
): readonly string[] => {
  if (plan.harnesses.length === 0) {
    return ['No harnesses selected. Set `harnesses.link` in settings.yml or pass --harness.'];
  }

  const changes = plan.steps.filter((step) => step.action !== 'unchanged');
  const lines: string[] = [
    input.dryRun === true
      ? `Planned for ${plan.harnesses.join(', ')} (dry run — nothing written):`
      : `Linked ${plan.harnesses.join(', ')}:`,
    ...(changes.length === 0 ? ['  (already up to date)'] : changes.map(formatStep)),
    `${applied.created} created, ${applied.updated} updated, ${applied.removed} removed, ` +
      `${applied.unchanged} unchanged, ${applied.conflicts.length} conflicts.`,
  ];

  return lines;
};

export interface LinkCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly writeLine?: (message: string) => void;
  /** Warnings and errors. Separate from `writeLine` so stdout stays parseable under `--json`. */
  readonly writeErrorLine?: (message: string) => void;
}

const parseHarnesses = (value: string | undefined): readonly HarnessId[] | undefined => {
  if (value === undefined) return undefined;

  const requested = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  const unknown = requested.filter((entry) => !isHarnessId(entry));

  if (unknown.length > 0) {
    throw new Error(`Unknown harness(es): ${unknown.join(', ')}. Supported: ${HARNESS_IDS.join(', ')}.`);
  }

  return requested as readonly HarnessId[];
};

export const createLinkCommand = (dependencies: LinkCommandDependencies = {}): CommandObject => ({
  name: 'link',
  description: 'Link the resolved .agents catalog into installed coding harnesses.',
  register(program: Command): void {
    program.addCommand(
      new Command('link')
        .description('Link the resolved .agents catalog into installed coding harnesses.')
        .option('--harness <ids>', 'Comma-separated harnesses to provision (claude, codex, gemini, copilot).')
        .option('--dry-run', 'Show what would change without writing anything.')
        .option('--remove', 'Remove every link Outfitter created and forget the manifest.')
        .option('--force', 'Replace paths Outfitter does not manage. Off by default.')
        .option('--strict', 'Treat unsupported resource/harness combinations as failures.')
        .option('--json', 'Emit the plan and result as JSON.')
        .action(
          (options: {
            harness?: string;
            dryRun?: boolean;
            remove?: boolean;
            force?: boolean;
            strict?: boolean;
            json?: boolean;
          }) => {
            /* v8 ignore next 3 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
            const homeDirectory = resolveHomeDirectory(dependencies.homeDirectory);
            const projectDirectory = resolveProjectDirectory(dependencies.projectDirectory);
            /* v8 ignore next -- process env is the direct-CLI path; tests inject env. */
            const env = dependencies.env ?? process.env;

            const result = executeLinkCommand({
              homeDirectory,
              projectDirectory,
              env,
              harnesses: parseHarnesses(options.harness),
              dryRun: options.dryRun,
              remove: options.remove,
              force: options.force,
              strict: options.strict,
              json: options.json,
            });

            for (const message of result.messages) {
              /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
              (dependencies.writeLine ?? console.log)(message);
            }

            for (const message of result.diagnostics) {
              /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
              (dependencies.writeErrorLine ?? console.error)(message);
            }

            if (!result.ok) {
              process.exitCode = 1;
            }
          },
        ),
    );
  },
});
