// Tests fixture-backed setup-source symlink import behavior.
import { cpSync, lstatSync, mkdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { cleanupIntegrationFixtures, copyFixtureToTemp } from './fixtureHarness.js';

afterEach(() => {
  cleanupIntegrationFixtures();
});

describe('integration fixture setup-source symlink import', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1.24, OFTR-004.1.25, OFTR-004.1.26, OFTR-004.1.27).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('links project .outfitter to a local setup source only when symlink mode is selected', async () => {
    const fixture = copyFixtureToTemp('local_setup_source_symlink');
    const sourcePath = join(fixture.root, 'source');
    const sourceOutfitterPath = join(sourcePath, '.outfitter');

    await executeSetupCommand(
      { homeDirectory: fixture.home, projectDirectory: fixture.project, setupSourceUri: sourcePath },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        selectSetupSourceImportTarget: () => Promise.resolve('project'),
        selectSetupSourceImportMode: (choices, defaultMode) => {
          expect(defaultMode).toBe('copy');
          expect(choices.map((choice) => choice.mode)).toEqual(['copy', 'symlink']);
          return Promise.resolve('symlink');
        },
        selectDefaultProfile: () => Promise.resolve('team'),
        selectSetupSourceLaunchAction: () => Promise.resolve('exit'),
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            mkdirSync(cachePath, { recursive: true });
            cpSync(sourceOutfitterPath, join(cachePath, '.outfitter'), { recursive: true });
          },
        },
      },
    );

    const targetOutfitterPath = join(fixture.project, '.outfitter');
    expect(lstatSync(targetOutfitterPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(targetOutfitterPath)).toBe(sourceOutfitterPath);
  });
});
