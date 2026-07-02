// Flow-level tests for /outfitter onboarding writes, validation, and cancellations.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createOutfitterPaths,
  runCreateProfileOnboarding,
  runDefaultCatalogOnboarding,
  runProvidedSourceOnboarding,
  runRemoteSettingsOnboarding,
} from '../src/onboardingFlows.js';
import type { InstallTarget, OnboardingFs, OutfitterPaths, ProfileChoice, QuestionUi } from '../src/types.js';
import { clearPrivateCatalogModuleStub, createExtensionConfig, stubPrivateCatalogModule } from './harness.js';

const realFs: OnboardingFs = {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  dirname,
  join,
};

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-onboarding-flow-'));
  temporaryRoots.push(root);
  return root;
};

interface QuestionUiScript {
  readonly installTarget?: (paths: OutfitterPaths) => InstallTarget | undefined;
  readonly profile?: ProfileChoice | undefined;
  readonly inputs?: readonly (string | undefined)[];
  readonly confirmPrivateCatalog?: boolean;
}

interface ScriptedQuestionUi extends QuestionUi {
  readonly notifications: string[];
}

const homeInstallTarget = (paths: OutfitterPaths): InstallTarget => ({
  id: 'home',
  settingsPath: paths.homeSettingsPath,
  profilesPath: paths.homeProfilesPath,
});

const createQuestionUiScript = (script: QuestionUiScript): ScriptedQuestionUi => {
  const notifications: string[] = [];
  const inputs = [...(script.inputs ?? [])];

  return {
    notifications,
    selectSetupMode: () => Promise.resolve('default' as const),
    selectInstallTarget: (paths) => Promise.resolve((script.installTarget ?? homeInstallTarget)(paths)),
    selectProfile: () => Promise.resolve(script.profile),
    input: (_message, defaultValue) => Promise.resolve(inputs.length > 0 ? inputs.shift() : defaultValue),
    confirmPrivateCatalog: () => Promise.resolve(script.confirmPrivateCatalog ?? true),
    notify: (message) => {
      notifications.push(message);
    },
  };
};

const createPaths = (root: string): { config: ReturnType<typeof createExtensionConfig>; paths: OutfitterPaths } => {
  const config = createExtensionConfig({
    homeDirectory: join(root, 'home'),
    projectDirectory: join(root, 'project'),
    defaultProfilesPath: join(root, 'default-profiles'),
  });
  return { config, paths: createOutfitterPaths(config, join) };
};

afterEach(() => {
  clearPrivateCatalogModuleStub();
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('runDefaultCatalogOnboarding', () => {
  it('reports an empty default catalog without writing settings', async () => {
    const root = createTemporaryRoot();
    const { config, paths } = createPaths(root);
    const questionUi = createQuestionUiScript({});

    await runDefaultCatalogOnboarding(config, realFs, paths, questionUi);

    expect(questionUi.notifications[0]).toContain('No profiles were found in the default Outfitter profile catalog.');
    expect(existsSync(paths.homeSettingsPath)).toBe(false);
  });

  it('rejects selected profiles with unsafe ids and cancelled selections', async () => {
    const root = createTemporaryRoot();
    const { config, paths } = createPaths(root);
    mkdirSync(join(root, 'default-profiles', 'founder'), { recursive: true });
    writeFileSync(join(root, 'default-profiles', 'founder', 'profile.yml'), 'id: founder\ncontrols: {}\n');

    const cancelled = createQuestionUiScript({ profile: undefined });
    await runDefaultCatalogOnboarding(config, realFs, paths, cancelled);
    expect(cancelled.notifications).toContain('Outfitter setup cancelled; no settings were changed.');

    const unsafe = createQuestionUiScript({ profile: { id: '../escape' } });
    await runDefaultCatalogOnboarding(config, realFs, paths, unsafe);
    expect(unsafe.notifications).toContain('Selected profile id is not filesystem-safe; no settings were changed.');

    const targetCancelled = createQuestionUiScript({ profile: { id: 'founder' }, installTarget: () => undefined });
    await runDefaultCatalogOnboarding(config, realFs, paths, targetCancelled);
    expect(targetCancelled.notifications).toContain('Outfitter setup cancelled; no settings were changed.');
    expect(existsSync(paths.homeSettingsPath)).toBe(false);
  });

  it('updates an existing settings file in place, replacing or appending default_profile', async () => {
    const root = createTemporaryRoot();
    const { config, paths } = createPaths(root);
    mkdirSync(join(root, 'default-profiles', 'founder'), { recursive: true });
    writeFileSync(join(root, 'default-profiles', 'founder', 'profile.yml'), 'id: founder\ncontrols: {}\n');
    mkdirSync(dirname(paths.homeSettingsPath), { recursive: true });
    writeFileSync(paths.homeSettingsPath, 'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n');

    const replace = createQuestionUiScript({ profile: { id: 'founder' } });
    await runDefaultCatalogOnboarding(config, realFs, paths, replace);
    expect(readFileSync(paths.homeSettingsPath, 'utf8')).toBe(
      'default_profile: founder\nprofile_sources:\n  - path: ./profiles\n',
    );

    writeFileSync(paths.homeSettingsPath, 'profile_sources:\n  - path: ./profiles\n');
    const append = createQuestionUiScript({ profile: { id: 'founder' } });
    await runDefaultCatalogOnboarding(config, realFs, paths, append);
    expect(readFileSync(paths.homeSettingsPath, 'utf8')).toBe(
      'profile_sources:\n  - path: ./profiles\ndefault_profile: founder\n',
    );
  });
});

describe('runCreateProfileOnboarding', () => {
  it('rejects unsafe or cancelled profile ids', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);

    const unsafe = createQuestionUiScript({ inputs: ['Bad Id!'] });
    await runCreateProfileOnboarding(realFs, paths, unsafe);
    expect(unsafe.notifications).toContain('Profile id is not filesystem-safe; no settings were changed.');

    const cancelled = createQuestionUiScript({ inputs: [undefined] });
    await runCreateProfileOnboarding(realFs, paths, cancelled);
    expect(cancelled.notifications).toContain('Profile id is not filesystem-safe; no settings were changed.');
    expect(existsSync(paths.homeSettingsPath)).toBe(false);
  });

  it('cancels before writing when the install target is dismissed', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    const questionUi = createQuestionUiScript({ inputs: ['my_profile', 'My Label'], installTarget: () => undefined });

    await runCreateProfileOnboarding(realFs, paths, questionUi);

    expect(questionUi.notifications).toContain('Outfitter setup cancelled; no settings were changed.');
    expect(existsSync(paths.homeSettingsPath)).toBe(false);
  });

  it('updates existing settings and falls back to the id when the label is blank', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    mkdirSync(dirname(paths.homeSettingsPath), { recursive: true });
    writeFileSync(paths.homeSettingsPath, 'default_profile: engineer\n');
    const questionUi = createQuestionUiScript({ inputs: ['my_profile', ''] });

    await runCreateProfileOnboarding(realFs, paths, questionUi);

    expect(readFileSync(paths.homeSettingsPath, 'utf8')).toBe('default_profile: my_profile\n');
    expect(readFileSync(join(paths.homeProfilesPath, 'my_profile', 'profile.yml'), 'utf8')).toBe(
      ['id: my_profile', 'label: my_profile', 'description: User-created Outfitter profile.', 'controls: {}', ''].join(
        '\n',
      ),
    );
  });
});

describe('runRemoteSettingsOnboarding', () => {
  it('rejects malformed repositories and unsafe settings paths', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    stubPrivateCatalogModule({});

    const badRepo = createQuestionUiScript({ inputs: ['not-a-repo', 'main', 'settings.yml'] });
    await runRemoteSettingsOnboarding(realFs, paths, badRepo);
    expect(badRepo.notifications).toContain('Catalog repo must use owner/repo syntax; no settings were changed.');

    const escapingPath = createQuestionUiScript({ inputs: ['owner/repo', 'main', '../settings.yml'] });
    await runRemoteSettingsOnboarding(realFs, paths, escapingPath);
    expect(escapingPath.notifications).toContain(
      'Catalog settings path must stay inside the repository; no settings were changed.',
    );

    const absolutePath = createQuestionUiScript({ inputs: ['owner/repo', 'main', '/etc/settings.yml'] });
    await runRemoteSettingsOnboarding(realFs, paths, absolutePath);
    expect(absolutePath.notifications).toContain(
      'Catalog settings path must stay inside the repository; no settings were changed.',
    );
    expect(existsSync(paths.homeSettingsPath)).toBe(false);
  });

  it('declines private catalogs when the user cancels the confirmation', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    stubPrivateCatalogModule({ visibility: 'private' });
    const questionUi = createQuestionUiScript({
      inputs: ['company/private-profiles', 'main', 'settings.yml'],
      confirmPrivateCatalog: false,
    });

    await runRemoteSettingsOnboarding(realFs, paths, questionUi);

    expect(questionUi.notifications).toContain('Private catalog setup was cancelled; no settings were changed.');
    expect(existsSync(paths.homeSettingsPath)).toBe(false);
  });

  it('enables private catalogs in home settings and writes the enterprise block for home installs', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    const { enabledWrites } = stubPrivateCatalogModule({ visibility: 'private' });
    const questionUi = createQuestionUiScript({
      inputs: ['company/private-profiles', 'main', 'settings.yml'],
    });

    await runRemoteSettingsOnboarding(realFs, paths, questionUi);

    expect(enabledWrites).toEqual([paths.homeSettingsPath]);
    expect(readFileSync(paths.homeSettingsPath, 'utf8')).toBe(
      [
        'enterprise:',
        '  private_profile_catalogs: true',
        'remote_settings:',
        '  - github: company/private-profiles',
        '    ref: main',
        '    path: settings.yml',
        '',
      ].join('\n'),
    );
    expect(questionUi.notifications).toContain(
      'Outfitter enabled private profile catalogs in ~/.outfitter/settings.yml and saved this catalog.',
    );
  });

  it('skips the private-catalog confirmation when the enterprise setting is already enabled', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    stubPrivateCatalogModule({ visibility: 'private', alreadyEnabled: true });
    const projectTarget = (targetPaths: OutfitterPaths): InstallTarget => ({
      id: 'project',
      settingsPath: targetPaths.projectSettingsPath,
      profilesPath: targetPaths.projectProfilesPath,
    });
    const questionUi = createQuestionUiScript({
      inputs: ['company/private-profiles', 'main', 'settings.yml'],
      installTarget: projectTarget,
    });

    await runRemoteSettingsOnboarding(realFs, paths, questionUi);

    expect(readFileSync(paths.projectSettingsPath, 'utf8')).toBe(
      ['remote_settings:', '  - github: company/private-profiles', '    ref: main', '    path: settings.yml', ''].join(
        '\n',
      ),
    );
  });

  it('cancels after the private-catalog confirmation when the install target is dismissed', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    const { enabledWrites } = stubPrivateCatalogModule({ visibility: 'private' });
    const questionUi = createQuestionUiScript({
      inputs: ['company/private-profiles', 'main', 'settings.yml'],
      installTarget: () => undefined,
    });

    await runRemoteSettingsOnboarding(realFs, paths, questionUi);

    expect(questionUi.notifications).toContain('Outfitter setup cancelled; no settings were changed.');
    expect(enabledWrites).toEqual([]);
  });

  it('applies default ref and settings path values from blank answers', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    stubPrivateCatalogModule({});
    const questionUi = createQuestionUiScript({ inputs: ['owner/repo', '', ''] });

    await runRemoteSettingsOnboarding(realFs, paths, questionUi);

    expect(readFileSync(paths.homeSettingsPath, 'utf8')).toBe(
      ['remote_settings:', '  - github: owner/repo', '    ref: main', '    path: settings.yml', ''].join('\n'),
    );
  });
});

describe('runProvidedSourceOnboarding', () => {
  it('cancels without writing when the install target is dismissed', async () => {
    const root = createTemporaryRoot();
    const { paths } = createPaths(root);
    const questionUi = createQuestionUiScript({ installTarget: () => undefined });

    await runProvidedSourceOnboarding(realFs, paths, questionUi, 'https://example.test/catalog.git');

    expect(questionUi.notifications).toContain('Outfitter setup cancelled; no settings were changed.');
    expect(existsSync(paths.homeSettingsPath)).toBe(false);
  });
});
