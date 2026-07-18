// Projects a harness-neutral CompositionPlan to a native pi or Claude Code launch.
import type { CompositionPlan } from '../composer/Composition.js';
import type { Harness } from '../settings/Settings.js';
import { materializeComposition } from './Materialize.js';
import type { AgentLaunchPlan, AgentProjectionPlan, ProjectionInput } from './Projection.js';

// Loadout elements each harness can project today; anything else surfaces as unsupported.
const supportedElements: Readonly<Record<Harness, readonly string[]>> = {
  pi: ['skills', 'model', 'thinking', 'extensions', 'plugins', 'mcp'],
  claude: ['skills', 'model', 'thinking', 'mcp'],
};

const loadoutElementsInUse = (composition: CompositionPlan): readonly string[] => {
  const { loadout } = composition;
  const present: string[] = [];

  if (loadout.skills.length > 0) present.push('skills');
  if (loadout.extensions.length > 0) present.push('extensions');
  if (loadout.plugins.length > 0) present.push('plugins');
  if (loadout.mcp.length > 0) present.push('mcp');
  if (loadout.model !== undefined) present.push('model');
  if (loadout.thinking !== undefined) present.push('thinking');

  return present;
};

export const unsupportedElements = (composition: CompositionPlan, harness: Harness): readonly string[] =>
  loadoutElementsInUse(composition).filter((element) => !supportedElements[harness].includes(element));

const promptArgs = (systemPromptPath: string, appendPromptPaths: readonly string[]): readonly string[] => [
  '--system-prompt',
  systemPromptPath,
  ...appendPromptPaths.flatMap((path) => ['--append-system-prompt', path]),
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

  return {
    command: isPi ? 'pi' : 'claude',
    args: [
      ...promptArgs(systemPromptPath, appendPromptPaths),
      ...skillArgs,
      ...modelArgs(composition, input.harness),
      ...(input.passThroughArgs ?? []),
    ],
    env: isPi ? { PI_CODING_AGENT_DIR: input.rootDirectory } : { CLAUDE_CONFIG_DIR: input.rootDirectory },
  };
};

/** Materializes the composition into the runtime root and builds the harness launch plan. */
export const projectComposition = (composition: CompositionPlan, input: ProjectionInput): AgentProjectionPlan => {
  const materialized = materializeComposition(composition, input.rootDirectory);
  const launch = buildLaunchPlan(composition, input, materialized.systemPromptPath, materialized.appendPromptPaths);

  return { rootDirectory: input.rootDirectory, launch, unsupported: unsupportedElements(composition, input.harness) };
};
