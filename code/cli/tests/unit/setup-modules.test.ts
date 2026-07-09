// Tests the extracted setup flow modules: prompts, source import, starter sources, and launch messages.
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  promptForSetupProfileWithReadline,
  promptForSetupSourceLaunchAction,
  runSetupSourceOnboarding,
} from '../../src/cli/commands/setup/SetupPrompts.js';
import { applySetupSourceImport, symlinkLocalOutfitterSource } from '../../src/cli/commands/setup/SetupSourceImport.js';
import {
  formatRunProfileExample,
  formatSetupSourceExitMessages,
} from '../../src/cli/commands/setup/SetupSourceLaunch.js';
import {
  prepareStarterLayout,
  resolveLocalSetupSourceOutfitterPathFromUri,
} from '../../src/cli/commands/setup/SetupStarterSource.js';
import type { StarterLayout } from '../../src/cli/commands/setup/SetupTypes.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-setup-modules-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop() as string, { recursive: true, force: true });
  }
});

const createScriptedReadline = (answers: readonly string[]): { question(query: string): Promise<string> } => {
  const remaining = [...answers];
  return {
    question: () => Promise.resolve(remaining.shift() ?? ''),
  };
};

const createSinkOutput = (): { output: Pick<NodeJS.WritableStream, 'write'>; lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    output: {
      write(message: string) {
        lines.push(message);
        return true;
      },
    },
  };
};

const writeLocalSetupSource = (root: string): string => {
  const sourceDirectory = join(root, 'shared-source');
  const outfitterDirectory = join(sourceDirectory, '.outfitter');
  mkdirSync(join(outfitterDirectory, 'profiles', 'founder'), { recursive: true });
  writeFileSync(
    join(outfitterDirectory, 'settings.yml'),
    'default_profile: founder\nprofile_sources:\n  - path: ./profiles\n',
  );
  writeFileSync(
    join(outfitterDirectory, 'profiles', 'founder', 'profile.yml'),
    'id: founder\nlabel: Founder\ncontrols: {}\n',
  );
  return sourceDirectory;
};

// Drives runSetupSourceOnboarding through real terminal streams, answering each readline
// question as its prompt appears; pre-buffered lines are consumed all at once by readline
// and would starve later questions.
const startReadlineSetupSourceOnboarding = (
  input: { homeDirectory: string; projectDirectory: string; setupSourceUri: string },
  starterLayout: StarterLayout,
  answers: string[],
): { onboarding: Promise<unknown>; written: string[] } => {
  const terminalInput = new PassThrough();
  const written: string[] = [];
  const terminalOutput = new PassThrough();
  terminalOutput.on('data', (chunk: Buffer) => {
    written.push(chunk.toString());
    if (chunk.toString().endsWith(']: ') && answers.length > 0) {
      setImmediate(() => terminalInput.write(`${answers.shift() ?? ''}\n`));
    }
  });

  return {
    onboarding: runSetupSourceOnboarding(
      input,
      { input: terminalInput, output: terminalOutput },
      starterLayout,
      'founder',
    ),
    written,
  };
};

describe('setup prompt readline flows', () => {
  it('defaults to a home-target copy import of the source default profile on blank answers', async () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const input = { homeDirectory: join(root, 'home'), projectDirectory: root, setupSourceUri: sourceDirectory };
    const starterLayout = prepareStarterLayout(input.homeDirectory, input.projectDirectory, sourceDirectory);

    const { onboarding } = startReadlineSetupSourceOnboarding(input, starterLayout, ['', '', '']);

    await expect(onboarding).resolves.toEqual({
      importTarget: 'home',
      importMode: 'copy',
      selectedProfileId: 'founder',
    });
  });

  it('rejects out-of-range import target and import mode selections', async () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const input = { homeDirectory: join(root, 'home'), projectDirectory: root, setupSourceUri: sourceDirectory };
    const starterLayout = prepareStarterLayout(input.homeDirectory, input.projectDirectory, sourceDirectory);

    await expect(startReadlineSetupSourceOnboarding(input, starterLayout, ['9']).onboarding).rejects.toThrow(
      'Selected setup-source import target number is out of range.',
    );
    await expect(startReadlineSetupSourceOnboarding(input, starterLayout, ['1', '9']).onboarding).rejects.toThrow(
      'Selected setup-source import mode number is out of range.',
    );
  });

  it('skips the import mode prompt when the setup source is not a local directory', async () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const input = {
      homeDirectory: join(root, 'home'),
      projectDirectory: root,
      setupSourceUri: 'https://example.test/repo.git',
    };
    const starterLayout: StarterLayout = {
      cachePath: join(sourceDirectory, '.outfitter'),
      settingsPath: join(sourceDirectory, '.outfitter', 'settings.yml'),
      profilesPath: join(sourceDirectory, '.outfitter', 'profiles'),
      sourceKind: 'remote-cache',
    };

    const { onboarding, written } = startReadlineSetupSourceOnboarding(input, starterLayout, ['', '']);

    await expect(onboarding).resolves.toEqual({
      importTarget: 'home',
      importMode: 'copy',
      selectedProfileId: 'founder',
    });
    expect(written.join('')).not.toContain('Choose how to install this local setup source:');
  });

  it('falls back to the current default when no profiles were discovered', async () => {
    const { output, lines } = createSinkOutput();

    await expect(
      promptForSetupProfileWithReadline(createScriptedReadline(['']), output, [], 'engineer', 'Choose:'),
    ).resolves.toBe('engineer');
    expect(lines.join('')).toContain('1. engineer');
  });

  it('runs the full readline setup-source onboarding against terminal streams', async () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const input = {
      homeDirectory: join(root, 'home'),
      projectDirectory: root,
      setupSourceUri: sourceDirectory,
    };
    const starterLayout = prepareStarterLayout(input.homeDirectory, input.projectDirectory, sourceDirectory);

    const { onboarding, written } = startReadlineSetupSourceOnboarding(input, starterLayout, ['2', '2', '1']);

    await expect(onboarding).resolves.toEqual({
      importTarget: 'project',
      importMode: 'symlink',
      selectedProfileId: 'founder',
    });
    expect(written.join('')).toContain('Local setup source detected.');
    expect(written.join('')).toContain('Choose where to install these profiles:');
    expect(written.join('')).toContain('Choose how to install this local setup source:');
  });

  it('asks whether to start Outfitter after import through the terminal streams', async () => {
    const declineInput = new PassThrough();
    declineInput.write('n\n');
    await expect(
      promptForSetupSourceLaunchAction('founder', 'selected', {
        input: declineInput,
        output: new PassThrough(),
      }),
    ).resolves.toBe('exit');

    const acceptInput = new PassThrough();
    acceptInput.write('\n');
    await expect(
      promptForSetupSourceLaunchAction('founder', 'default', {
        input: acceptInput,
        output: new PassThrough(),
      }),
    ).resolves.toBe('start');
  });
});

describe('setup source symlink import', () => {
  it('creates the development symlink and replaces an empty existing target directory', () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const sourceOutfitterPath = join(sourceDirectory, '.outfitter');
    const targetOutfitterPath = join(root, 'target', '.outfitter');
    mkdirSync(targetOutfitterPath, { recursive: true });

    symlinkLocalOutfitterSource(sourceOutfitterPath, targetOutfitterPath);

    expect(lstatSync(targetOutfitterPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(targetOutfitterPath)).toBe(sourceOutfitterPath);
  });

  it('refuses to replace a non-empty target directory', () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const targetOutfitterPath = join(root, 'target', '.outfitter');
    mkdirSync(targetOutfitterPath, { recursive: true });
    writeFileSync(join(targetOutfitterPath, 'settings.yml'), 'default_profile: existing\n');

    expect(() => symlinkLocalOutfitterSource(join(sourceDirectory, '.outfitter'), targetOutfitterPath)).toThrow(
      'Cannot symlink local setup source into non-empty .outfitter directory',
    );
  });

  it('turns Windows symlink permission failures into actionable Developer Mode guidance', () => {
    const root = createTemporaryRoot();
    const targetOutfitterPath = join(root, 'target', '.outfitter');
    const throwWithCode = (code: string) => () => {
      throw Object.assign(new Error(`${code}: operation not permitted`), { code });
    };

    expect(() =>
      symlinkLocalOutfitterSource(join(root, 'source'), targetOutfitterPath, throwWithCode('EPERM'), 'win32'),
    ).toThrow(/Developer Mode.*copy snapshot import mode/su);
    expect(() =>
      symlinkLocalOutfitterSource(join(root, 'source'), targetOutfitterPath, throwWithCode('EACCES'), 'win32'),
    ).toThrow(/Developer Mode/u);
    // Non-Windows platforms and unrelated codes keep the original error.
    expect(() =>
      symlinkLocalOutfitterSource(join(root, 'source'), targetOutfitterPath, throwWithCode('EPERM'), 'linux'),
    ).toThrow('EPERM: operation not permitted');
    expect(() =>
      symlinkLocalOutfitterSource(join(root, 'source'), targetOutfitterPath, throwWithCode('ENOENT'), 'win32'),
    ).toThrow('ENOENT: operation not permitted');
  });

  it('rejects symlink imports without a usable local setup source', () => {
    const root = createTemporaryRoot();
    const onboarding = { importTarget: 'project', importMode: 'symlink', selectedProfileId: 'founder' } as const;
    const starterLayout = {
      cachePath: join(root, 'cache'),
      sourceKind: 'remote-cache',
    } as const;

    expect(() =>
      applySetupSourceImport(
        { homeDirectory: join(root, 'home'), projectDirectory: root, setupSourceUri: 'https://example.test/x.git' },
        starterLayout,
        onboarding,
      ),
    ).toThrow('Local setup-source symlink mode requires a source .outfitter directory.');

    const bareSource = join(root, 'bare-source', '.outfitter');
    mkdirSync(bareSource, { recursive: true });
    expect(() =>
      applySetupSourceImport(
        { homeDirectory: join(root, 'home'), projectDirectory: root, setupSourceUri: join(root, 'bare-source') },
        { cachePath: bareSource, sourceKind: 'local-live', sourceOutfitterPath: bareSource },
        onboarding,
      ),
    ).toThrow('Local setup-source symlink mode requires source .outfitter/settings.yml.');

    writeFileSync(
      join(bareSource, 'settings.yml'),
      'default_profile: founder\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(() =>
      applySetupSourceImport(
        { homeDirectory: join(root, 'home'), projectDirectory: root, setupSourceUri: join(root, 'bare-source') },
        { cachePath: bareSource, sourceKind: 'local-live', sourceOutfitterPath: bareSource },
        onboarding,
      ),
    ).toThrow("Local setup-source symlink mode requires selected profile 'founder'.");
  });
});

describe('starter layout resolution', () => {
  it('resolves local setup sources with and without settings and profiles', () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const withSettings = prepareStarterLayout(join(root, 'home'), root, sourceDirectory);
    expect(withSettings.sourceKind).toBe('local-live');
    expect(withSettings.settingsPath).toBe(join(sourceDirectory, '.outfitter', 'settings.yml'));
    expect(withSettings.profilesPath).toBe(join(sourceDirectory, '.outfitter', 'profiles'));

    const bareDirectory = join(root, 'bare');
    mkdirSync(join(bareDirectory, '.outfitter'), { recursive: true });
    const withoutSettings = prepareStarterLayout(join(root, 'home'), root, bareDirectory);
    expect(withoutSettings.settingsPath).toBeUndefined();
    expect(withoutSettings.profilesPath).toBeUndefined();
  });

  it('resolves .outfitter-suffixed and absolute local source paths', () => {
    const root = createTemporaryRoot();
    const sourceDirectory = writeLocalSetupSource(root);
    const outfitterPath = join(sourceDirectory, '.outfitter');

    expect(resolveLocalSetupSourceOutfitterPathFromUri(outfitterPath, root)).toBe(outfitterPath);
    expect(resolveLocalSetupSourceOutfitterPathFromUri('shared-source', root)).toBe(outfitterPath);
    expect(resolveLocalSetupSourceOutfitterPathFromUri('https://example.test/repo.git', root)).toBeUndefined();
    expect(resolveLocalSetupSourceOutfitterPathFromUri(join(root, 'missing'), root)).toBeUndefined();
  });
});

describe('setup source exit messages', () => {
  it('describes launching the current default profile after conflicting imports', () => {
    const root = createTemporaryRoot();
    const input = { homeDirectory: join(root, 'home'), projectDirectory: root };

    expect(formatSetupSourceExitMessages(input, 'home', 'founder', 'default')).toEqual([
      'Start the current default profile:\n  outfitter',
    ]);
  });

  it('explains hidden home imports when project settings override profile sources', () => {
    const root = createTemporaryRoot();
    const input = { homeDirectory: join(root, 'home'), projectDirectory: root };

    const messages = formatSetupSourceExitMessages(input, 'home', 'ghost-profile', 'selected');
    expect(messages[0]).toContain("Imported profile 'ghost-profile' into user home");
    expect(messages[0]).toContain('project overrides profile_sources');
  });

  it('treats invalid settings as launchable so setup errors stay actionable elsewhere', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'default_profile: [broken\n');

    expect(
      formatSetupSourceExitMessages({ homeDirectory, projectDirectory: root }, 'home', 'anything', 'selected'),
    ).toEqual([formatRunProfileExample('anything')]);
  });
});
