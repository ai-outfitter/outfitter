// Shared helpers for adapter profile controls and argv construction.
import type { ProfileControls } from '../profiles/Profile.js';
import { mergeLaunchResourceSources } from './LaunchResources.js';

export const genericControlNames = new Set([
  'model',
  'provider',
  'thinking',
  'environment',
  'args',
  'sessionDirectory',
  'session_directory',
  'extensions',
  'skills',
  'promptTemplate',
  'prompt_template',
  'systemPrompt',
  'system_prompt',
  'appendSystemPrompt',
  'append_system_prompt',
  'pi',
  'claude',
]);

export const supportedControlNames = (controls: ReadonlySet<string>): readonly string[] =>
  [...controls].filter((controlName) => !controlName.includes('_') && controlName !== 'pi' && controlName !== 'claude');

export const controlAliases = [
  { camelCase: 'sessionDirectory', snakeCase: 'session_directory' },
  { camelCase: 'promptTemplate', snakeCase: 'prompt_template' },
  { camelCase: 'systemPrompt', snakeCase: 'system_prompt' },
  { camelCase: 'appendSystemPrompt', snakeCase: 'append_system_prompt' },
] as const;

export const mergeAgentSpecificControls = <T extends ProfileControls>(
  controls: ProfileControls,
  agentKey: 'pi' | 'claude',
): T => {
  const agentControls = controls[agentKey];

  return {
    ...controls,
    ...definedControls(agentControls),
    environment: { ...controls.environment, ...agentControls?.environment },
    args: agentControls?.args ?? controls.args,
    extensions: mergeLaunchResourceSources('extension', controls.extensions, agentControls?.extensions),
    skills: mergeLaunchResourceSources('skill', controls.skills, agentControls?.skills),
  } as T;
};

export const flagValue = (flag: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [flag, value];

export const repeatFlag = (flag: string, values: readonly string[] | undefined): readonly string[] =>
  values === undefined ? [] : values.flatMap((value) => [flag, value]);

export const findUnsupportedControlNames = (
  controls: Readonly<Record<string, unknown>>,
  supportedControls: ReadonlySet<string>,
  knownControls: ReadonlySet<string> = genericControlNames,
): string[] => {
  const controlNames = new Set(Object.keys(controls));
  const unsupported: string[] = [];

  for (const { camelCase, snakeCase } of controlAliases) {
    if (!controlNames.has(camelCase) && !controlNames.has(snakeCase)) {
      continue;
    }

    if (!supportedControls.has(camelCase) && !supportedControls.has(snakeCase)) {
      unsupported.push(controlNames.has(snakeCase) ? snakeCase : camelCase);
    }

    controlNames.delete(camelCase);
    controlNames.delete(snakeCase);
  }

  unsupported.push(
    ...[...controlNames].filter(
      (controlName) => !knownControls.has(controlName) || !supportedControls.has(controlName),
    ),
  );

  return unsupported;
};

const definedControls = (controls: ProfileControls['pi'] | undefined): Partial<ProfileControls> => {
  if (controls === undefined) {
    return {};
  }

  return Object.fromEntries(Object.entries(controls).filter((entry) => entry[1] !== undefined));
};
