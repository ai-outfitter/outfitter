// Projects a harness-neutral CompositionPlan to a native pi or Claude Code launch.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PI_SESSION_DIRECTORY_ENV } from '../agents/PiSessionDirectory.js';
import type { CompositionPlan } from '../composer/Composition.js';
import type { Harness } from '../settings/Settings.js';
import { materializeComposition, materializeConfigurationOverlays } from './Materialize.js';
import type { AgentLaunchPlan, AgentProjectionPlan, ProjectionInput } from './Projection.js';

// Loadout elements a projection actually maps to native config. Anything else is reported
// unsupported so `--strict` catches silently-dropped selections. Baseline for both harnesses is
// identity + skills + model + thinking. Pi also projects selected subagents and MCP servers into
// its runtime config directory, and projects `extensions` once the run path has resolved their
// install dirs (`extensionLoadDirs`). plugins/tools remain unsupported pending incremental parity
// (#183).
const supportedElements = (input: ProjectionInput): readonly string[] => {
  const baseline = ['skills', 'model', 'thinking'];
  if (input.harness !== 'pi') return baseline;
  const pi = [...baseline, 'subagents', 'mcp', 'prompt_template'];
  return input.extensionLoadDirs === undefined ? pi : [...pi, 'extensions'];
};

const loadoutElementsInUse = (composition: CompositionPlan): readonly string[] => {
  const { loadout } = composition;
  const present: string[] = [];

  if (loadout.skills.length > 0) present.push('skills');
  if (loadout.subagents.length > 0) present.push('subagents');
  if (loadout.extensions.length > 0) present.push('extensions');
  if (loadout.plugins.length > 0) present.push('plugins');
  if (loadout.mcp.length > 0) present.push('mcp');
  if (loadout.model !== undefined) present.push('model');
  if (loadout.thinking !== undefined) present.push('thinking');
  if (loadout.tools !== undefined) present.push('tools');
  if (composition.identity.promptTemplate !== undefined) present.push('prompt_template');

  return present;
};

export const unsupportedElements = (composition: CompositionPlan, input: ProjectionInput): readonly string[] =>
  loadoutElementsInUse(composition).filter((element) => !supportedElements(input).includes(element));

/**
 * The two harnesses take append-prompt documents through incompatible flags, verified against
 * pi 0.x via `outfitter run` and Claude Code 2.1.x directly:
 *
 * | | pi | claude |
 * | `--append-system-prompt <path>` | reads the file, repeatable, accumulates | appends the path *text* |
 * | `--append-system-prompt-file <path>` | rejected: `Unknown option` | reads the file |
 * | repeated flags | accumulate | last one wins |
 *
 * So pi gets a repeated flag per document, while Claude gets a single
 * `--append-system-prompt-file` over a concatenation — one flag because repeats overwrite, and the
 * `-file` form because the bare flag would otherwise append the literal path and silently drop
 * every document. Emitting the pi form to Claude loses the content without an error.
 */
const appendPromptArgs = (harness: Harness, rootDirectory: string, paths: readonly string[]): readonly string[] => {
  /* v8 ignore next 2 -- unreachable through composition, which always contributes the agent body;
     kept because projectComposition is exported and an empty list must not name an empty file. */
  if (paths.length === 0) return [];
  if (harness === 'pi') return paths.flatMap((path) => ['--append-system-prompt', path]);

  const combinedPath = join(rootDirectory, 'append-system-prompt.md');
  // A trailing newline per document so a file that lacks one cannot glue onto the next.
  writeFileSync(combinedPath, paths.map((path) => `${readFileSync(path, 'utf8')}\n`).join(''));
  return ['--append-system-prompt-file', combinedPath];
};

const promptArgs = (
  composition: CompositionPlan,
  input: ProjectionInput,
  systemPromptPath: string,
  appendPromptPaths: readonly string[],
): readonly string[] => [
  '--system-prompt',
  systemPromptPath,
  ...appendPromptArgs(input.harness, input.rootDirectory, appendPromptPaths),
  ...(input.harness === 'pi' && composition.identity.promptTemplate !== undefined
    ? ['--prompt-template', `${input.rootDirectory}/prompt-template.md`]
    : []),
];

const modelArgs = (composition: CompositionPlan, harness: Harness): readonly string[] => {
  const args: string[] = [];

  if (composition.loadout.model !== undefined) {
    args.push('--model', composition.loadout.model);
  }

  if (composition.loadout.thinking !== undefined) {
    args.push(harness === 'pi' ? '--thinking' : '--effort', composition.loadout.thinking);
  }

  return args;
};

const buildLaunchPlan = (
  composition: CompositionPlan,
  input: ProjectionInput,
  systemPromptPath: string,
  appendPromptPaths: readonly string[],
): AgentLaunchPlan => {
  const isPi = input.harness === 'pi';
  const skillArgs = isPi ? composition.loadout.skills.flatMap((skill) => ['--skill', skill.slug]) : [];
  const extensionArgs = isPi ? (input.extensionLoadDirs ?? []).flatMap((dir) => ['--extension', dir]) : [];

  return {
    command: isPi ? 'pi' : 'claude',
    args: [
      ...promptArgs(composition, input, systemPromptPath, appendPromptPaths),
      ...skillArgs,
      ...extensionArgs,
      ...modelArgs(composition, input.harness),
      ...(input.passThroughArgs ?? []),
    ],
    // The projection root is deleted after the run, so pi's default session store (a subdirectory
    // of PI_CODING_AGENT_DIR) would take every transcript with it. A resolved session directory
    // moves the store somewhere durable so `--continue`/`--resume` still find the last conversation.
    env: isPi
      ? {
          PI_CODING_AGENT_DIR: input.rootDirectory,
          ...(input.sessionDirectory === undefined ? {} : { [PI_SESSION_DIRECTORY_ENV]: input.sessionDirectory }),
        }
      : { CLAUDE_CONFIG_DIR: input.rootDirectory },
  };
};

/** Materializes the composition into the runtime root and builds the harness launch plan. */
export const projectComposition = (composition: CompositionPlan, input: ProjectionInput): AgentProjectionPlan => {
  if (input.harness === 'pi') {
    materializeConfigurationOverlays(input.configurationOverlayDirectories ?? [], input.rootDirectory);
  }
  const materialized = materializeComposition(composition, input.rootDirectory);
  // Caller documents follow the composition's own, so a persona is read against the agent it adopts.
  const launch = buildLaunchPlan(composition, input, materialized.systemPromptPath, [
    ...materialized.appendPromptPaths,
    ...(input.appendPromptPaths ?? []),
  ]);
  const unsupported = [
    ...unsupportedElements(composition, input),
    ...materialized.skippedSkills.map((slug) => `skill:${slug} (escaping symlink)`),
    ...materialized.skippedSubagents.map((slug) => `subagent:${slug} (invalid definition)`),
  ];

  return { rootDirectory: input.rootDirectory, launch, unsupported };
};
