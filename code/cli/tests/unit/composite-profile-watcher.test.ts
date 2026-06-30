// Tests composite profile input watching and generated file refresh behavior.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';
import {
  createProfileWatchPaths,
  compositeProfileFileOutputPath,
  watchCompositeProfileInputs,
} from '../../src/compositeProfile/CompositeProfileWatcher.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-compositeProfile-watcher-'));
  temporaryRoots.push(root);
  return root;
};

const waitForFileContent = async (path: string, content: string): Promise<void> => {
  await waitForFileMatching(path, (actual) => actual === content);
  expect(readFileSync(path, 'utf8')).toBe(content);
};

const waitForFileMatching = async (path: string, predicate: (content: string) => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (existsSync(path) && predicate(readFileSync(path, 'utf8'))) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const waitForWarningContaining = async (warnings: readonly string[], content: string): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (warnings.some((warning) => warning.includes(content))) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  expect(warnings).toEqual(expect.arrayContaining([expect.stringContaining(content)]));
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('composite profile input watching', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('watches composite profile inputs, rewrites safe generated files, and warns when an input cannot be watched', async () => {
    const warnings: string[] = [];
    const compositeProfile = createCompositeProfile('/tmp/outfitter-watch-test', [
      createCompositeProfileFile({
        relativePath: 'outfitter/profile.json',
        content: '{}\n',
        sourceInputs: ['/path/that/does/not/exist/profile.yml'],
      }),
    ]);
    const handle = watchCompositeProfileInputs({ compositeProfile, warn: (message) => warnings.push(message) });

    handle.close();

    expect(warnings[0]).toContain('Could not watch composite profile input /path/that/does/not/exist/profile.yml');
    expect(createProfileWatchPaths(['/profiles/default/profile.yml', '/profiles/default/other.yml'])).toEqual([
      '/profiles/default',
    ]);
    expect(compositeProfileFileOutputPath(compositeProfile, 'outfitter/profile.json')).toBe(
      '/tmp/outfitter-watch-test/outfitter/profile.json',
    );

    const root = createTemporaryRoot();
    const watchedDirectory = join(root, 'watched');
    const watchedInput = join(watchedDirectory, 'profile.yml');
    const outputRoot = join(root, 'compositeProfile');
    mkdirSync(watchedDirectory, { recursive: true });
    writeFileSync(watchedInput, 'initial\n');
    const watchedCompositeProfile = createCompositeProfile(outputRoot, [
      createCompositeProfileFile({ relativePath: 'generated.txt', content: 'stale\n', sourceInputs: [watchedInput] }),
    ]);
    const watchedHandle = watchCompositeProfileInputs({
      compositeProfile: watchedCompositeProfile,
      refreshCompositeProfile: () =>
        createCompositeProfile(outputRoot, [
          createCompositeProfileFile({
            relativePath: 'generated.txt',
            content: 'updated\n',
            sourceInputs: [watchedInput],
          }),
        ]),
      warn: (message) => warnings.push(message),
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      writeFileSync(watchedInput, 'changed\n');
      await waitForFileContent(join(outputRoot, 'generated.txt'), 'updated\n');
    } finally {
      watchedHandle.close();
    }

    const staticInput = join(watchedDirectory, 'static-profile.yml');
    const staticOutputRoot = join(root, 'static-compositeProfile');
    writeFileSync(staticInput, 'initial\n');
    const staticCompositeProfile = createCompositeProfile(staticOutputRoot, [
      createCompositeProfileFile({ relativePath: 'generated.txt', content: 'static\n', sourceInputs: [staticInput] }),
    ]);
    const staticHandle = watchCompositeProfileInputs({
      compositeProfile: staticCompositeProfile,
      warn: (message) => warnings.push(message),
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      writeFileSync(staticInput, 'changed\n');
      await waitForFileContent(join(staticOutputRoot, 'generated.txt'), 'static\n');
    } finally {
      staticHandle.close();
    }

    const failingInput = join(watchedDirectory, 'failing-profile.yml');
    writeFileSync(failingInput, 'initial\n');
    const refreshErrors: unknown[] = [];
    const failingHandle = watchCompositeProfileInputs({
      compositeProfile: createCompositeProfile(join(root, 'failing-compositeProfile'), [
        createCompositeProfileFile({ relativePath: 'generated.txt', content: 'stale\n', sourceInputs: [failingInput] }),
      ]),
      refreshCompositeProfile() {
        throw new Error('regeneration failed');
      },
      onRefreshError: (error) => refreshErrors.push(error),
      warn: (message) => warnings.push(message),
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 25));
      writeFileSync(failingInput, 'changed\n');
      await waitForWarningContaining(warnings, 'Could not safely update compositeProfile');
    } finally {
      failingHandle.close();
    }

    expect(refreshErrors).toHaveLength(1);
    expect(warnings.at(-1)).toContain('regeneration failed');
  });
});
