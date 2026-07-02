// Post-import launch messaging and actions for setup-source onboarding.
import { loadLocalProfileSource } from '../../../profiles/ProfileLoader.js';
import { resolveProfile } from '../../../profiles/ProfileMerger.js';
import { loadSettingsWithCachedRemoteSettings } from '../../../settings/SettingsLoader.js';
import { materializeSetupProfileSource, promptForSetupSourceLaunchAction } from './SetupPrompts.js';
import type {
  SetupCommandDependencies,
  SetupCommandInput,
  SetupSourceImportTarget,
  SetupSourcePostImportAction,
  SetupSourcePostImportLaunchTarget,
} from './SetupTypes.js';

export const formatRunProfileExample = (profileId: string): string =>
  `Start the selected default profile either way:\n  outfitter\n  outfitter --profile ${profileId}`;

const formatRunDefaultProfileExample = (): string => `Start the current default profile:\n  outfitter`;

/* v8 ignore start -- setup-source launch visibility fallbacks are exercised through integration-style CLI flows; unit tests cover the primary imported-profile outcomes. */
export const formatSetupSourceExitMessages = (
  input: SetupCommandInput,
  importTarget: SetupSourceImportTarget,
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
): readonly string[] => {
  if (launchTarget === 'default') {
    return [formatRunDefaultProfileExample()];
  }

  if (importTarget !== 'home' || canResolveProfileForLaunch(input, profileId)) {
    return [formatRunProfileExample(profileId)];
  }

  return [formatHiddenHomeImportMessage(profileId)];
};

const formatHiddenHomeImportMessage = (profileId: string): string =>
  `Imported profile '${profileId}' into user home, but this project overrides profile_sources and does not expose ~/.outfitter/profiles. ` +
  'Import into the current project, add ~/.outfitter/profiles to project profile_sources, or run from a directory without project Outfitter settings.';

export const runSetupSourcePostImportAction = async (
  input: SetupCommandInput,
  dependencies: SetupCommandDependencies,
  importTarget: SetupSourceImportTarget,
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
): Promise<SetupSourcePostImportAction> => {
  if (
    dependencies.interactive !== true ||
    (dependencies.launchSetupSourceProfile === undefined && dependencies.selectSetupSourceLaunchAction === undefined)
  ) {
    return 'exit';
  }

  const action = await selectSetupSourceLaunchAction(profileId, launchTarget, dependencies);

  if (action === 'start') {
    if (launchTarget === 'selected') {
      assertSetupSourceProfileCanLaunch(input, importTarget, profileId);
    }

    await dependencies.launchSetupSourceProfile?.({
      homeDirectory: input.homeDirectory,
      projectDirectory: input.projectDirectory,
      profileId: launchTarget === 'selected' ? profileId : undefined,
    });
  }

  return action;
};

const assertSetupSourceProfileCanLaunch = (
  input: SetupCommandInput,
  importTarget: SetupSourceImportTarget,
  profileId: string,
): void => {
  if (importTarget !== 'home' || canResolveProfileForLaunch(input, profileId)) {
    return;
  }

  throw new Error(formatHiddenHomeImportMessage(profileId));
};

const canResolveProfileForLaunch = (input: SetupCommandInput, profileId: string): boolean => {
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input);

  if (loadedSettings.issues.length > 0) {
    return true;
  }

  const profiles = loadedSettings.settings.profileSources!.flatMap(
    (source) =>
      loadLocalProfileSource({
        path: materializeSetupProfileSource(input.homeDirectory, source),
        only: source.only,
        except: source.except,
      }).profiles,
  );
  const resolution = resolveProfile({ profiles, profileId });
  const selectedProfile = resolution.profileStack.find((profile) => profile.id === profileId);

  return resolution.profile !== undefined && resolution.issues.length === 0 && selectedProfile?.template !== true;
};

const selectSetupSourceLaunchAction = async (
  profileId: string,
  launchTarget: SetupSourcePostImportLaunchTarget,
  dependencies: SetupCommandDependencies,
): Promise<SetupSourcePostImportAction> => {
  if (dependencies.selectSetupSourceLaunchAction !== undefined) {
    return dependencies.selectSetupSourceLaunchAction(profileId, launchTarget);
  }

  return promptForSetupSourceLaunchAction(profileId, launchTarget, dependencies);
};

/* v8 ignore stop */
