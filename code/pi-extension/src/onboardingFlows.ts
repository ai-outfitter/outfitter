// The /outfitter onboarding flows: default catalog, custom profile, remote catalog, provided source.
import type { OutfitterExtensionConfig } from './config.js';
import { OUTFITTER_PROFILE_ID_PATTERN, readCurrentDefaultProfile, discoverProfileChoices } from './profileDiscovery.js';
import type { OnboardingFs, OutfitterPaths, QuestionUi } from './types.js';
import { loadPrivateCatalogOnboarding } from './types.js';

const setupCancelledMessage = 'Outfitter setup cancelled; no settings were changed.';

export const createOutfitterPaths = (config: OutfitterExtensionConfig, join: OnboardingFs['join']): OutfitterPaths => ({
  homeSettingsPath: join(config.homeDirectory, '.outfitter', 'settings.yml'),
  homeProfilesPath: join(config.homeDirectory, '.outfitter', 'profiles'),
  projectSettingsPath: join(config.projectDirectory, '.outfitter', 'settings.yml'),
  projectProfilesPath: join(config.projectDirectory, '.outfitter', 'profiles'),
  defaultProfilesPath: config.defaultProfilesPath,
});

export const runDefaultCatalogOnboarding = async (
  config: OutfitterExtensionConfig,
  fs: OnboardingFs,
  paths: OutfitterPaths,
  questionUi: QuestionUi,
): Promise<void> => {
  const currentDefault = readCurrentDefaultProfile(paths.homeSettingsPath, fs.existsSync, fs.readFileSync);
  const profiles = discoverProfileChoices(fs, paths, currentDefault);
  if (profiles.length === 0) {
    questionUi.notify(
      'No profiles were found in the default Outfitter profile catalog. Fix the catalog sync or provide a different catalog.',
      'error',
    );
    return;
  }

  const selectedProfile = await questionUi.selectProfile(profiles, currentDefault);
  if (selectedProfile === undefined) {
    questionUi.notify(setupCancelledMessage, 'warning');
    return;
  }

  if (!OUTFITTER_PROFILE_ID_PATTERN.test(selectedProfile.id)) {
    questionUi.notify('Selected profile id is not filesystem-safe; no settings were changed.', 'error');
    return;
  }

  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify(setupCancelledMessage, 'warning');
    return;
  }

  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  fs.mkdirSync(installTarget.profilesPath, { recursive: true });
  const settingsExisted = fs.existsSync(installTarget.settingsPath);
  if (settingsExisted) {
    updateExistingSettingsDefaultProfile(
      installTarget.settingsPath,
      selectedProfile.id,
      fs.readFileSync,
      fs.writeFileSync,
    );
  } else {
    fs.writeFileSync(installTarget.settingsPath, createDefaultSettingsContent(config, selectedProfile.id));
  }

  questionUi.notify(
    [
      "Outfitter saved default profile '" + selectedProfile.id + "' to " + installTarget.settingsPath + '.',
      'Profile choices were loaded from the default Outfitter profile catalog, not generated locally.',
      "It applies on the next 'outfitter' launch; restart Outfitter to load the selected profile.",
    ].join('\n'),
    'info',
  );
};

export const runCreateProfileOnboarding = async (
  fs: OnboardingFs,
  paths: OutfitterPaths,
  questionUi: QuestionUi,
): Promise<void> => {
  const profileId = normalizeInputValue(await questionUi.input('Profile id', 'my_profile'));
  if (profileId === undefined || profileId === '' || !OUTFITTER_PROFILE_ID_PATTERN.test(profileId)) {
    questionUi.notify('Profile id is not filesystem-safe; no settings were changed.', 'error');
    return;
  }
  const label = normalizeInputValue(await questionUi.input('Profile label', profileId));
  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify(setupCancelledMessage, 'warning');
    return;
  }

  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  if (fs.existsSync(installTarget.settingsPath)) {
    updateExistingSettingsDefaultProfile(installTarget.settingsPath, profileId, fs.readFileSync, fs.writeFileSync);
  } else {
    fs.writeFileSync(installTarget.settingsPath, createLocalProfileSettingsContent(profileId));
  }

  const profilePath = fs.join(installTarget.profilesPath, profileId, 'profile.yml');
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(fs.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, createUserProfileContent(profileId, label));
  }

  questionUi.notify(
    [
      "Outfitter created profile '" + profileId + "' at " + profilePath + '.',
      'Outfitter saved settings to ' + installTarget.settingsPath + '.',
      "It applies on the next 'outfitter' launch; restart Outfitter to load the selected profile.",
    ].join('\n'),
    'info',
  );
};

interface RemoteCatalogRequest {
  readonly github: string;
  readonly ref: string;
  readonly settingsPath: string;
}

const promptForRemoteCatalogRequest = async (questionUi: QuestionUi): Promise<RemoteCatalogRequest | undefined> => {
  const github = normalizeInputValue(
    await questionUi.input('GitHub catalog repo (owner/repo)', 'my_account/outfitter_config'),
  );
  const ref = normalizeInputValue(await questionUi.input('Catalog ref', 'main')) || 'main';
  const settingsPath =
    normalizeInputValue(await questionUi.input('Catalog settings path', 'settings.yml')) || 'settings.yml';
  if (!github || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(github)) {
    questionUi.notify('Catalog repo must use owner/repo syntax; no settings were changed.', 'error');
    return undefined;
  }
  if (settingsPath.startsWith('/') || settingsPath.includes('..')) {
    questionUi.notify('Catalog settings path must stay inside the repository; no settings were changed.', 'error');
    return undefined;
  }

  return { github, ref, settingsPath };
};

interface PrivateCatalogDecision {
  readonly cancelled: boolean;
  readonly alreadyEnabled: boolean;
  readonly accepted: boolean;
}

const decidePrivateCatalogUse = async (
  fs: OnboardingFs,
  paths: OutfitterPaths,
  questionUi: QuestionUi,
  github: string,
): Promise<PrivateCatalogDecision> => {
  const privateCatalogOnboarding = await loadPrivateCatalogOnboarding();
  const alreadyEnabled = privateCatalogOnboarding.readPrivateProfileCatalogsEnabled(fs, paths.homeSettingsPath);
  if (alreadyEnabled || (await privateCatalogOnboarding.classifyGitHubRepositoryVisibility(github)) !== 'private') {
    return { cancelled: false, alreadyEnabled, accepted: false };
  }

  const accepted = await questionUi.confirmPrivateCatalog(github);
  if (!accepted) {
    questionUi.notify('Private catalog setup was cancelled; no settings were changed.', 'warning');
    return { cancelled: true, alreadyEnabled, accepted: false };
  }

  return { cancelled: false, alreadyEnabled, accepted: true };
};

export const runRemoteSettingsOnboarding = async (
  fs: OnboardingFs,
  paths: OutfitterPaths,
  questionUi: QuestionUi,
): Promise<void> => {
  const request = await promptForRemoteCatalogRequest(questionUi);
  if (request === undefined) {
    return;
  }

  const privateCatalog = await decidePrivateCatalogUse(fs, paths, questionUi, request.github);
  if (privateCatalog.cancelled) {
    return;
  }

  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify(setupCancelledMessage, 'warning');
    return;
  }

  if (privateCatalog.accepted) {
    const privateCatalogOnboarding = await loadPrivateCatalogOnboarding();
    privateCatalogOnboarding.writePrivateProfileCatalogsEnabled(fs, paths.homeSettingsPath);
  }

  const privateCatalogsEnabled = privateCatalog.alreadyEnabled || privateCatalog.accepted;
  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  fs.writeFileSync(
    installTarget.settingsPath,
    createRemoteSettingsContent(
      request.github,
      request.ref,
      request.settingsPath,
      privateCatalogsEnabled && installTarget.settingsPath === paths.homeSettingsPath,
    ),
  );
  questionUi.notify(
    privateCatalog.accepted
      ? 'Outfitter enabled private profile catalogs in ~/.outfitter/settings.yml and saved this catalog.'
      : [
          'Outfitter saved remote settings catalog to ' + installTarget.settingsPath + '.',
          "Run 'outfitter sync' or restart Outfitter after the catalog is reachable.",
        ].join('\n'),
    'info',
  );
};

export const runProvidedSourceOnboarding = async (
  fs: OnboardingFs,
  paths: OutfitterPaths,
  questionUi: QuestionUi,
  sourceUri: string,
): Promise<void> => {
  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify(setupCancelledMessage, 'warning');
    return;
  }

  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  fs.writeFileSync(installTarget.settingsPath, createProvidedSourceSettingsContent(sourceUri));
  questionUi.notify(
    [
      'Outfitter saved setup source to ' + installTarget.settingsPath + '.',
      "Run 'outfitter sync' or restart Outfitter after the source is reachable.",
    ].join('\n'),
    'info',
  );
};

export const normalizeInputValue = (value: string | undefined): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

const createProvidedSourceSettingsContent = (sourceUri: string): string =>
  ['remote_settings:', '  - uri: ' + JSON.stringify(sourceUri), '    path: settings.yml', ''].join('\n');

const createDefaultSettingsContent = (config: OutfitterExtensionConfig, profileId: string): string =>
  config.defaultSettingsTemplate.replace('__OUTFITTER_PROFILE_ID__', profileId);

const createLocalProfileSettingsContent = (profileId: string): string =>
  ['default_profile: ' + profileId, 'profile_sources:', '  - path: ./profiles', ''].join('\n');

const createRemoteSettingsContent = (
  github: string,
  ref: string,
  path: string,
  privateCatalogsEnabled: boolean,
): string =>
  [
    ...(privateCatalogsEnabled ? ['enterprise:', '  private_profile_catalogs: true'] : []),
    'remote_settings:',
    '  - github: ' + github,
    '    ref: ' + ref,
    '    path: ' + path,
    '',
  ].join('\n');

const updateExistingSettingsDefaultProfile = (
  settingsPath: string,
  profileId: string,
  readFileSync: OnboardingFs['readFileSync'],
  writeFileSync: OnboardingFs['writeFileSync'],
): void => {
  const content = readFileSync(settingsPath, 'utf8');
  const nextContent = /^default_profile:.*$/mu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, 'default_profile: ' + profileId)
    : content.replace(/\s*$/u, '\n') + 'default_profile: ' + profileId + '\n';
  writeFileSync(settingsPath, nextContent);
};

const createUserProfileContent = (profileId: string, label: string | undefined): string =>
  [
    'id: ' + profileId,
    'label: ' + (label !== undefined && label !== '' ? label : profileId),
    'description: User-created Outfitter profile.',
    'controls: {}',
    '',
  ].join('\n');
