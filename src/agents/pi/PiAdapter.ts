// Provides the pi adapter for tack generation and native pi launch plans.
import type { AgentAdapter, AgentLaunchPlan, AgentTackPlan } from '../AgentAdapter.js';
import type { PiProfileControls, Profile, ProfileControls } from '../../profiles/Profile.js';
import type { Tack } from '../../tack/Tack.js';
import { createTack } from '../../tack/Tack.js';
import { createTackFile } from '../../tack/TackFile.js';

const genericControlNames = new Set([
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
]);

const piControlNames = new Set([...genericControlNames].filter((controlName) => controlName !== 'pi'));

export const createPiAdapter = (): AgentAdapter => ({
  id: 'pi',
  supportedControls: [...genericControlNames].filter((controlName) => !controlName.includes('_')),
  createTack(profile: Profile, input): AgentTackPlan {
    const tack = createTack(input.rootDirectory, [
      createTackFile({
        rootDirectory: input.rootDirectory,
        relativePath: 'bridl/profile.json',
        content: `${JSON.stringify({ id: profile.id, label: profile.label, controls: profile.controls }, null, 2)}\n`,
        sourceInputs: input.profilePaths,
        strategy: 'transform',
      }),
    ]);

    return {
      tack,
      warnings: this.getUnsupportedControls(profile).map(
        (controlName) => `pi adapter cannot translate requested control '${controlName}'.`,
      ),
    };
  },
  createLaunchPlan(tack: Tack, profile?: Profile, passThroughArgs: readonly string[] = []): AgentLaunchPlan {
    const controls = mergePiControls(profile?.controls ?? {});

    return {
      command: 'pi',
      args: [...createPiArgs(controls), ...passThroughArgs],
      env: {
        ...controls.environment,
        PI_CODING_AGENT_DIR: tack.rootDirectory,
      },
    };
  },
  getUnsupportedControls(profile: Profile): readonly string[] {
    return findUnsupportedControls(profile.controls);
  },
});

const mergePiControls = (controls: ProfileControls): PiProfileControls => ({
  ...controls,
  ...definedControls(controls.pi),
  environment: { ...controls.environment, ...controls.pi?.environment },
});

const definedControls = (controls: PiProfileControls | undefined): Partial<PiProfileControls> => {
  if (controls === undefined) {
    return {};
  }

  return Object.fromEntries(Object.entries(controls).filter((entry) => entry[1] !== undefined));
};

const createPiArgs = (controls: PiProfileControls): readonly string[] => [
  ...flagValue('--model', controls.model),
  ...flagValue('--provider', controls.provider),
  ...flagValue('--thinking', controls.thinking),
  ...flagValue('--session-dir', controls.sessionDirectory),
  ...flagValue('--prompt-template', controls.promptTemplate),
  ...flagValue('--system-prompt', controls.systemPrompt),
  ...flagValue('--append-system-prompt', controls.appendSystemPrompt),
  ...repeatFlag('--extension', controls.extensions),
  ...repeatFlag('--skill', controls.skills),
  ...(controls.args ?? []),
];

const flagValue = (flag: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [flag, value];

const repeatFlag = (flag: string, values: readonly string[] | undefined): readonly string[] =>
  values === undefined ? [] : values.flatMap((value) => [flag, value]);

const findUnsupportedControls = (controls: ProfileControls): readonly string[] => {
  const unsupported = Object.keys(controls).filter((controlName) => !genericControlNames.has(controlName));

  if (controls.pi !== undefined) {
    unsupported.push(
      ...Object.keys(controls.pi)
        .filter((controlName) => !piControlNames.has(controlName))
        .map((controlName) => `pi.${controlName}`),
    );
  }

  return unsupported;
};
