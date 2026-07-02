// Behavioral tests for the /outfitter onboarding command registered by the extension.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  activateExtension,
  cleanupTemporaryRoots,
  clearPrivateCatalogModuleStub,
  createTemporaryRoot,
  runOutfitterCommand,
  startMockSession,
  stubPrivateCatalogModule,
  writeDefaultProfilesCatalog,
} from './harness.js';

afterEach(() => {
  clearPrivateCatalogModuleStub();
  cleanupTemporaryRoots();
});

describe('/outfitter onboarding', () => {
  it('auto-opens native /outfitter during first-run runtime onboarding', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({
      homeDirectory: root,
      projectDirectory: root,
      autoOpenOutfitter: true,
    });

    await startMockSession(pi, mock);

    expect(mock.editorText).toBe('/outfitter');
    expect(mock.submittedInputs).toEqual(['\r']);
  });

  it('registers native /outfitter and persists the selected default profile', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const defaultProfilesPath = writeDefaultProfilesCatalog(root);
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project'), defaultProfilesPath },
      {
        selectedOptions: [
          'Use the default Outfitter profile catalog',
          'data_analyst — Data Analyst',
          'Home folder (~/.outfitter)',
        ],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(mock.selectCalls[0]).toEqual({
      title: 'How would you like to set up Outfitter?',
      options: [
        'Use the default Outfitter profile catalog',
        'Create your own profile',
        'Provide a different catalog to import',
      ],
    });
    expect(mock.customRenders[0]?.join('\n')).toContain('founder — Founder (Recommended)');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe(
      [
        'default_profile: data_analyst',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );
    expect(existsSync(join(homeDirectory, '.outfitter', 'profiles'))).toBe(true);
    expect(mock.notifications.join('\n')).toContain("applies on the next 'outfitter' launch");
  });

  it('creates a custom profile without overwriting an existing user profile', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const existingProfilePath = join(homeDirectory, '.outfitter', 'profiles', 'founder', 'profile.yml');
    const existingProfileContent = 'id: founder\nlabel: User-owned file\ncontrols: {}\n';
    mkdirSync(dirname(existingProfilePath), { recursive: true });
    writeFileSync(existingProfilePath, existingProfileContent);
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project') },
      {
        inputValues: ['founder', 'Founder'],
        selectedOptions: ['Create your own profile', 'Home folder (~/.outfitter)'],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(readFileSync(existingProfilePath, 'utf8')).toBe(existingProfileContent);
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: founder',
    );
  });

  it('persists an imported catalog as remote_settings in the selected project directory', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    stubPrivateCatalogModule({ visibility: 'public' });
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory },
      {
        inputValues: ['my_account/outfitter_config', 'main', 'settings.yml'],
        selectedOptions: ['Provide a different catalog to import', 'Current project directory (.outfitter)'],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe(
      [
        'remote_settings:',
        '  - github: my_account/outfitter_config',
        '    ref: main',
        '    path: settings.yml',
        '',
      ].join('\n'),
    );
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  it('routes the private-catalog confirmation through the enterprise module', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const { enabledWrites } = stubPrivateCatalogModule({ visibility: 'private', confirm: true });
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory },
      {
        inputValues: ['company/private-profiles', 'main', 'settings.yml'],
        selectedOptions: ['Provide a different catalog to import', 'Current project directory (.outfitter)'],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(enabledWrites).toEqual([join(homeDirectory, '.outfitter', 'settings.yml')]);
    expect(readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'github: company/private-profiles',
    );
    expect(mock.notifications).toContain(
      'Outfitter enabled private profile catalogs in ~/.outfitter/settings.yml and saved this catalog.',
    );
  });

  it('writes the provided setup source and cancels cleanly when dismissed', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const { pi, mock } = activateExtension(
      {
        homeDirectory,
        projectDirectory: join(root, 'project'),
        setupSourceUri: 'https://example.test/catalog.git',
      },
      { selectedOptions: ['Home folder (~/.outfitter)'] },
    );

    await runOutfitterCommand(pi, mock);

    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe(
      ['remote_settings:', '  - uri: "https://example.test/catalog.git"', '    path: settings.yml', ''].join('\n'),
    );
  });

  it('cancels setup without changes when the mode selection is dismissed', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project') },
      { selectedOptions: [undefined] },
    );

    await runOutfitterCommand(pi, mock);

    expect(mock.notifications).toContain('Outfitter setup cancelled; no settings were changed.');
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  it('cancels without changes when the profile or install-target selector is dismissed', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const defaultProfilesPath = writeDefaultProfilesCatalog(root);

    const profileCancelled = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project'), defaultProfilesPath },
      { selectedOptions: ['Use the default Outfitter profile catalog', undefined] },
    );
    await runOutfitterCommand(profileCancelled.pi, profileCancelled.mock);
    expect(profileCancelled.mock.notifications).toContain('Outfitter setup cancelled; no settings were changed.');

    const targetCancelled = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project'), defaultProfilesPath },
      {
        selectedOptions: ['Use the default Outfitter profile catalog', 'founder — Founder (Recommended)', undefined],
      },
    );
    await runOutfitterCommand(targetCancelled.pi, targetCancelled.mock);
    expect(targetCancelled.mock.notifications).toContain('Outfitter setup cancelled; no settings were changed.');
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  it('preselects the first profile when the catalog has no founder profile and no default is set', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const profilesPath = join(root, 'no-founder-profiles');
    mkdirSync(join(profilesPath, 'engineer'), { recursive: true });
    writeFileSync(join(profilesPath, 'engineer', 'profile.yml'), 'id: engineer\nlabel: Engineer\ncontrols: {}\n');
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project'), defaultProfilesPath: profilesPath },
      {
        selectedOptions: [
          'Use the default Outfitter profile catalog',
          'engineer — Engineer',
          'Home folder (~/.outfitter)',
        ],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(mock.customRenders[0]?.join('\n')).toContain('→ engineer — Engineer');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: engineer',
    );
  });

  it('marks the configured default profile as current and preselects it', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const defaultProfilesPath = writeDefaultProfilesCatalog(root);
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'default_profile: engineer\n');
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project'), defaultProfilesPath },
      {
        selectedOptions: [
          'Use the default Outfitter profile catalog',
          'engineer — Engineer (current)',
          'Home folder (~/.outfitter)',
        ],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(mock.customRenders[0]?.join('\n')).toContain('→ engineer — Engineer (current)');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe('default_profile: engineer\n');
  });

  it('does nothing without dialog-capable UI', async () => {
    const root = createTemporaryRoot();
    const { pi, mock } = activateExtension({ homeDirectory: root, projectDirectory: root }, { hasUI: false });

    await runOutfitterCommand(pi, mock);

    expect(mock.notifications).toEqual([]);
    expect(mock.selectCalls).toEqual([]);
  });

  it('falls back to plain selects and input prompts when custom UI is unavailable', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const defaultProfilesPath = writeDefaultProfilesCatalog(root);
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project'), defaultProfilesPath },
      {
        withCustomUi: false,
        withInputUi: false,
        selectedOptions: [
          'Use the default Outfitter profile catalog',
          'engineer — Engineer',
          'Home folder (~/.outfitter)',
        ],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(mock.customRenders).toEqual([]);
    expect(mock.selectCalls.length).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: engineer',
    );
  });

  it('collects custom profile input through select prompts when input UI is unavailable', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const { pi, mock } = activateExtension(
      { homeDirectory, projectDirectory: join(root, 'project') },
      {
        withInputUi: false,
        selectedOptions: ['Create your own profile', 'my_profile', 'my_profile', 'Home folder (~/.outfitter)'],
      },
    );

    await runOutfitterCommand(pi, mock);

    expect(mock.selectCalls[1]?.title).toBe('Profile id [my_profile]');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: my_profile',
    );
  });
});
