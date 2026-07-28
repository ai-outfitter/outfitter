// Projects a harness-neutral CompositionPlan to a native pi or Claude Code launch.
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

const promptArgs = (
  composition: CompositionPlan,
  input: ProjectionInput,
  systemPromptPath: string,
  appendPromptPaths: readonly string[],
): readonly string[] => [
  '--system-prompt',
  systemPromptPath,
  ...appendPromptPaths.flatMap((path) => ['--append-system-prompt', path]),
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
    env: isPi ? { PI_CODING_AGENT_DIR: input.rootDirectory } : { CLAUDE_CONFIG_DIR: input.rootDirectory },
  };
};

/** Materializes the composition into the runtime root and builds the harness launch plan. */
export const projectComposition = (composition: CompositionPlan, input: ProjectionInput): AgentProjectionPlan => {
  if (input.harness === 'pi') {
    materializeConfigurationOverlays(input.configurationOverlayDirectories ?? [], input.rootDirectory);
  }
  const materialized = materializeComposition(composition, input.rootDirectory);
  const launch = buildLaunchPlan(composition, input, materialized.systemPromptPath, materialized.appendPromptPaths);
  const unsupported = [
    ...unsupportedElements(composition, input),
    ...materialized.skippedSkills.map((slug) => `skill:${slug} (escaping symlink)`),
    ...materialized.skippedSubagents.map((slug) => `subagent:${slug} (invalid definition)`),
  ];

  return { rootDirectory: input.rootDirectory, launch, unsupported };
};
