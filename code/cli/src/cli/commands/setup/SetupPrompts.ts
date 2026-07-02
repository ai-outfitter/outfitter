// Interactive prompt flows for setup: profile choice, setup-source import target/mode, and launch action.
import { createInterface } from 'node:readline/promises';

import { redactProfileSourceUriCredentials } from '../../../profiles/ProfileCache.js';
import { writeWelcomeIntro } from '../WelcomeCommand.js';
import { updateSettingsDefaultProfile } from '../FirstRunWelcomeProfile.js';
import {
  assertValidDefaultProfileId,
  chooseSetupPromptDefault,
  discoverSetupProfileChoices,
  discoverSetupSourcePromptDefault,
  selectSetupPromptProfiles,
} from './SetupProfileDiscovery.js';
import { resolveLocalSetupSourceOutfitterPath } from './SetupStarterLayout.js';
import {
  setupSourceImportModeChoices,
  setupSourceImportTargetChoices,
  type SetupCommandDependencies,
  type SetupCommandInput,
  type SetupProfileChoice,
  type SetupSourceImportMode,
  type SetupSourceImportTarget,
  type SetupSourceImportTargetChoice,
  type SetupSourceOnboardingResult,
  type SetupSourcePostImportAction,
  type SetupSourcePostImportLaunchTarget,
  type StarterLayout,
} from './SetupTypes.js';

interface ReadlineLike {
  question(query: string): Promise<string>;
}

/* v8 ignore next -- default process stdout is direct terminal behavior; tests inject writable streams. */
const resolveReadlineOutput = (dependencies: SetupCommandDependencies): NodeJS.WritableStream =>
  typeof dependencies.output?.write === 'function' ? dependencies.output : process.stdout;

export const resolvePromptOutput = (dependencies: SetupCommandDependencies): Pick<NodeJS.WritableStream, 'write'> => {
  if (typeof dependencies.output?.write === 'function') {
    return dependencies.output;
  }

  if (dependencies.writeLine !== undefined) {
    return {
      write(message: string) {
        dependencies.writeLine?.(message.replace(/\n$/u, ''));
        return true;
      },
    };
  }

  /* v8 ignore next 7 -- defensive non-writable injected output fallback; normal tests inject writeLine or writable output. */
  if (dependencies.output !== undefined) {
    return {
      write() {
        return true;
      },
    };
  }

  return process.stdout;
};

export const runSetupSourceOnboarding = async (
  input: SetupCommandInput & { readonly setupSourceUri: string },
  dependencies: SetupCommandDependencies,
  starterLayout: StarterLayout,
  currentDefault: string,
): Promise<SetupSourceOnboardingResult> => {
  const discoveredProfiles = discoverSetupProfileChoices(input, starterLayout);
  const sourceDefault = discoverSetupSourcePromptDefault(input, starterLayout, discoveredProfiles);
  const promptDefault = chooseSetupPromptDefault(discoveredProfiles, sourceDefault, currentDefault);
  const profiles = selectSetupPromptProfiles(discoveredProfiles, currentDefault, promptDefault);
  const localSymlinkAvailable = resolveLocalSetupSourceOutfitterPath(input) !== undefined;

  if (
    dependencies.selectSetupSourceImportTarget === undefined &&
    dependencies.selectDefaultProfile === undefined &&
    dependencies.selectSetupSourceImportMode === undefined
  ) {
    return promptForSetupSourceOnboarding(input, profiles, promptDefault, localSymlinkAvailable, dependencies);
  }

  writeSetupSourceWelcome(input, profiles, resolvePromptOutput(dependencies));
  const importTarget = await selectSetupSourceImportTarget(dependencies);
  const importMode = await selectSetupSourceImportMode(dependencies, localSymlinkAvailable);
  const selectedProfileId = await selectSetupProfile(profiles, promptDefault, dependencies);
  assertValidSelectedDefaultProfile(selectedProfileId, profiles);

  return { importTarget, selectedProfileId, importMode };
};

const promptForSetupSourceOnboarding = async (
  input: SetupCommandInput & { readonly setupSourceUri: string },
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  localSymlinkAvailable: boolean,
  dependencies: SetupCommandDependencies,
): Promise<SetupSourceOnboardingResult> => {
  const output = resolvePromptOutput(dependencies);
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({
    input: dependencies.input ?? process.stdin,
    output: resolveReadlineOutput(dependencies),
  });

  try {
    writeSetupSourceWelcome(input, profiles, output);
    const importTarget = await promptForSetupSourceImportTargetWithReadline(
      readline,
      output,
      setupSourceImportTargetChoices,
      'home',
    );
    const importMode = await promptForSetupSourceImportModeWithReadline(readline, output, localSymlinkAvailable);
    const selectedProfileId = await promptForSetupProfileWithReadline(
      readline,
      output,
      profiles,
      currentDefault,
      'Choose the default profile from this setup source:',
    );
    assertValidSelectedDefaultProfile(selectedProfileId, profiles);

    return { importTarget, selectedProfileId, importMode };
  } finally {
    readline.close();
  }
};

const writeSetupSourceWelcome = (
  input: SetupCommandInput & { readonly setupSourceUri: string },
  profiles: readonly SetupProfileChoice[],
  output: Pick<NodeJS.WritableStream, 'write'>,
): void => {
  writeWelcomeIntro(output);
  output.write(
    `\nYou're importing Outfitter profiles from ${redactProfileSourceUriCredentials(input.setupSourceUri)}.\n`,
  );
  output.write(`Found ${profiles.length} profile(s)${formatSetupSourceProfileList(profiles)}.\n`);

  if (resolveLocalSetupSourceOutfitterPath(input) !== undefined) {
    output.write(
      'Local setup source detected. Copy snapshot setup is safest; symlink setup links your target .outfitter to the local source .outfitter so shared-profile edits apply immediately during development.\n',
    );
  }
};

const formatSetupSourceProfileList = (profiles: readonly SetupProfileChoice[]): string => {
  /* v8 ignore next -- setup-source profile prompts normally require discovered source profiles. */
  if (profiles.length === 0) {
    return '';
  }

  return `: ${profiles.map((profile) => profile.id).join(', ')}`;
};

const selectSetupSourceImportTarget = async (
  dependencies: SetupCommandDependencies,
): Promise<SetupSourceImportTarget> => {
  /* v8 ignore else -- mixed dependency injection path; the full readline path prompts with one shared readline. */
  if (dependencies.selectSetupSourceImportTarget !== undefined) {
    const selectedTarget = await dependencies.selectSetupSourceImportTarget(setupSourceImportTargetChoices, 'home');
    assertValidSetupSourceImportTarget(selectedTarget);
    return selectedTarget;
  }

  return 'home';
};

const selectSetupSourceImportMode = async (
  dependencies: SetupCommandDependencies,
  localSymlinkAvailable: boolean,
): Promise<SetupSourceImportMode> => {
  if (!localSymlinkAvailable) {
    return 'copy';
  }

  if (dependencies.selectSetupSourceImportMode !== undefined) {
    const selectedMode = await dependencies.selectSetupSourceImportMode(setupSourceImportModeChoices, 'copy');
    assertValidSetupSourceImportMode(selectedMode);
    return selectedMode;
  }

  return 'copy';
};

const assertValidSetupSourceImportMode = (mode: SetupSourceImportMode): void => {
  if (setupSourceImportModeChoices.every((choice) => choice.mode !== mode)) {
    throw new Error(`Selected setup-source import mode '${mode}' is not available.`);
  }
};

const assertValidSetupSourceImportTarget = (target: SetupSourceImportTarget): void => {
  /* v8 ignore next -- defensive validation for custom dependency injection. */
  if (setupSourceImportTargetChoices.every((choice) => choice.target !== target)) {
    throw new Error(`Selected setup-source import target '${target}' is not available.`);
  }
};

export const promptForSetupSourceImportTargetWithReadline = async (
  readline: ReadlineLike,
  output: Pick<NodeJS.WritableStream, 'write'>,
  choices: readonly SetupSourceImportTargetChoice[],
  defaultTarget: SetupSourceImportTarget,
): Promise<SetupSourceImportTarget> => {
  output.write('\nChoose where to install these profiles:\n');
  choices.forEach((choice, index) => {
    output.write(`${index + 1}. ${choice.label}\n`);
    output.write(`   ${choice.description}.\n`);
  });

  const defaultIndex = Math.max(
    choices.findIndex((choice) => choice.target === defaultTarget),
    0,
  );
  const answer = await readline.question(`Import target [${defaultIndex + 1}]: `);
  const selectedIndex = Number.parseInt(answer.trim() || String(defaultIndex + 1), 10) - 1;
  const selectedChoice = choices[selectedIndex];

  if (selectedChoice === undefined) {
    throw new Error('Selected setup-source import target number is out of range.');
  }

  return selectedChoice.target;
};

export const promptForSetupSourceImportModeWithReadline = async (
  readline: ReadlineLike,
  output: Pick<NodeJS.WritableStream, 'write'>,
  localSymlinkAvailable: boolean,
): Promise<SetupSourceImportMode> => {
  if (!localSymlinkAvailable) {
    return 'copy';
  }

  output.write('\nChoose how to install this local setup source:\n');
  setupSourceImportModeChoices.forEach((choice, index) => {
    output.write(`${index + 1}. ${choice.label}\n`);
    output.write(`   ${choice.description}.\n`);
  });

  const answer = await readline.question('Import mode [1]: ');
  const selectedIndex = Number.parseInt(answer.trim() || '1', 10) - 1;
  const selectedChoice = setupSourceImportModeChoices[selectedIndex];

  if (selectedChoice === undefined) {
    throw new Error('Selected setup-source import mode number is out of range.');
  }

  return selectedChoice.mode;
};

export const selectSetupSourceLaunchAction = async (
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
  dependencies: SetupCommandDependencies,
): Promise<SetupSourcePostImportAction> => {
  if (dependencies.selectSetupSourceLaunchAction !== undefined) {
    return dependencies.selectSetupSourceLaunchAction(profileId, launchTarget);
  }

  return promptForSetupSourceLaunchAction(profileId, launchTarget, dependencies);
};

const promptForSetupSourceLaunchAction = async (
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
  dependencies: SetupCommandDependencies,
): Promise<SetupSourcePostImportAction> => {
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({
    input: dependencies.input ?? process.stdin,
    output: resolveReadlineOutput(dependencies),
  });

  try {
    const prompt =
      launchTarget === 'selected'
        ? `Start Outfitter with profile '${profileId}' now? [Y/n]: `
        : 'Start Outfitter with the current default profile now? [Y/n]: ';
    const answer = await readline.question(prompt);
    return answer.trim().toLowerCase().startsWith('n') ? 'exit' : 'start';
  } finally {
    readline.close();
  }
};

export const selectDefaultProfileIfInteractive = async (
  input: SetupCommandInput,
  settingsPath: string,
  currentDefault: string,
  dependencies: SetupCommandDependencies,
  starterLayout?: StarterLayout,
): Promise<string> => {
  if (dependencies.interactive !== true) {
    return currentDefault;
  }

  const discoveredProfiles = discoverSetupProfileChoices(input, starterLayout);
  const sourceDefault = discoverSetupSourcePromptDefault(input, starterLayout, discoveredProfiles);
  const promptDefault = chooseSetupPromptDefault(discoveredProfiles, sourceDefault, currentDefault);
  const profiles = selectSetupPromptProfiles(discoveredProfiles, currentDefault, promptDefault);
  writeWelcomeIntro(resolvePromptOutput(dependencies));
  const selectedProfile = await selectSetupProfile(profiles, promptDefault, dependencies);
  assertValidSelectedDefaultProfile(selectedProfile, profiles);
  updateSettingsDefaultProfile(settingsPath, selectedProfile);
  return selectedProfile;
};

const assertValidSelectedDefaultProfile = (selectedProfile: string, profiles: readonly SetupProfileChoice[]): void => {
  assertValidDefaultProfileId(selectedProfile);

  if (profiles.length > 0 && profiles.every((profile) => profile.id !== selectedProfile)) {
    throw new Error(`Selected default profile '${selectedProfile}' was not one of the available setup profiles.`);
  }
};

const selectSetupProfile = async (
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  dependencies: SetupCommandDependencies,
): Promise<string> => {
  if (dependencies.selectDefaultProfile !== undefined) {
    return dependencies.selectDefaultProfile(profiles, currentDefault);
  }

  return promptForSetupProfile(profiles, currentDefault, dependencies);
};

const promptForSetupProfile = async (
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  dependencies: SetupCommandDependencies,
): Promise<string> => {
  const output = resolvePromptOutput(dependencies);
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({
    input: dependencies.input ?? process.stdin,
    output: resolveReadlineOutput(dependencies),
  });

  try {
    return await promptForSetupProfileWithReadline(
      readline,
      output,
      profiles,
      currentDefault,
      'Choose the default profile for your sessions:',
    );
  } finally {
    readline.close();
  }
};

export const promptForSetupProfileWithReadline = async (
  readline: ReadlineLike,
  output: Pick<NodeJS.WritableStream, 'write'>,
  profiles: readonly SetupProfileChoice[],
  currentDefault: string,
  heading: string,
): Promise<string> => {
  const candidates = profiles.length > 0 ? profiles : [{ id: currentDefault }];
  output.write(`\n${heading}\n`);
  candidates.forEach((profile, index) => {
    const label = profile.label === undefined ? '' : ` - ${profile.label}`;
    output.write(`${index + 1}. ${profile.id}${label}\n`);
    if (profile.description !== undefined) {
      output.write(`   ${profile.description}\n`);
    }
  });

  const currentIndex = Math.max(
    candidates.findIndex((profile) => profile.id === currentDefault),
    0,
  );
  const answer = await readline.question(`Default profile [${currentIndex + 1}]: `);
  const selectedIndex = Number.parseInt(answer.trim() || String(currentIndex + 1), 10) - 1;

  const selectedProfile = candidates[selectedIndex];

  if (selectedProfile === undefined) {
    throw new Error('Selected default profile number is out of range.');
  }

  return selectedProfile.id;
};
