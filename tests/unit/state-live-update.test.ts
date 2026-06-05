// Tests state-write accounting when live composite profile updates regenerate files.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import {
  createCompositeProfileStateBaseline,
  detectCompositeProfileStateWrites,
  updateCompositeProfileStateBaselinePaths,
} from '../../src/compositeProfile/StatePersistence.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'applepi-state-live-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.applepi'), { recursive: true });
  writeFileSync(join(homeDirectory, '.applepi', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): string => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  const profilePath = join(profileDirectory, 'profile.yml');
  writeFileSync(profilePath, content);
  return profilePath;
};

const waitForFileContent = async (path: string, content: string): Promise<void> => {
  for (let attempts = 0; attempts < 40; attempts += 1) {
    try {
      if (readFileSync(path, 'utf8') === content) {
        return;
      }
    } catch {
      // Retry until fs.watch has had a chance to write the generated file.
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  expect(readFileSync(path, 'utf8')).toBe(content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('live composite profile update state accounting', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.4, APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not report live-regenerated compositeProfile files as agent state writes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.applepi', 'profiles');
    const profilePath = writeProfile(profilesDirectory, 'default', 'id: default\nlabel: Initial\ncontrols: {}\n');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        adapter: {
          id: 'mock-agent',
          supportedControls: [],
          createCompositeProfile(profile, compositeProfileInput) {
            return {
              compositeProfile: createCompositeProfile(
                compositeProfileInput.rootDirectory,
                [
                  createCompositeProfileFile({
                    relativePath: 'generated.txt',
                    content: `${profile.label}\n`,
                    sourceInputs: compositeProfileInput.profilePaths,
                  }),
                ],
                [{ relativePath: 'unknown', strategy: 'warn', directory: false }],
              ),
              warnings: [],
            };
          },
          createLaunchPlan(compositeProfile) {
            return { command: 'mock-agent', args: [], env: { MOCK_AGENT_DIR: compositeProfile.rootDirectory } };
          },
          getUnsupportedControls() {
            return [];
          },
        },
        writeLine: () => undefined,
        launcher: {
          async launch(plan) {
            expect(readFileSync(join(plan.env.MOCK_AGENT_DIR, 'generated.txt'), 'utf8')).toBe('Initial\n');
            await new Promise((resolve) => setTimeout(resolve, 25));
            writeFileSync(profilePath, 'id: default\nlabel: Updated\ncontrols: {}\n');
            await waitForFileContent(join(plan.env.MOCK_AGENT_DIR, 'generated.txt'), 'Updated\n');
            return 0;
          },
        },
      },
    );

    expect(result.warnings).toEqual([]);
  });

  it('removes deleted generated files from refreshed state baselines', () => {
    const root = createTemporaryRoot();
    const generatedPath = join(root, 'generated.txt');
    mkdirSync(root, { recursive: true });
    writeFileSync(generatedPath, 'generated\n');
    const baseline = createCompositeProfileStateBaseline(root);

    rmSync(generatedPath);
    const updatedBaseline = updateCompositeProfileStateBaselinePaths(root, baseline, ['generated.txt']);

    expect(
      detectCompositeProfileStateWrites(
        root,
        [{ relativePath: 'unknown', strategy: 'warn', directory: false }],
        baseline,
      ),
    ).toEqual([{ relativePath: 'generated.txt', strategy: 'warn', unknown: true }]);
    expect(
      detectCompositeProfileStateWrites(
        root,
        [{ relativePath: 'unknown', strategy: 'warn', directory: false }],
        updatedBaseline,
      ),
    ).toEqual([]);
  });

  it('fingerprints special state entries without reading them as files', () => {
    const root = createTemporaryRoot();
    const pipePath = join(root, 'cache', 'pipe');
    mkdirSync(join(root, 'cache'), { recursive: true });
    const baseline = createCompositeProfileStateBaseline(root);

    execFileSync('mkfifo', [pipePath]);

    expect(
      detectCompositeProfileStateWrites(
        root,
        [{ relativePath: 'cache/', strategy: 'warn', directory: true }],
        baseline,
      ),
    ).toEqual([{ relativePath: 'cache/', strategy: 'warn', unknown: false }]);
  });

  it('skips discard state subtrees while creating and comparing snapshots', () => {
    const root = createTemporaryRoot();
    const pipePath = join(root, 'cache', 'pipe');
    const statePaths = [
      { relativePath: 'cache/', strategy: 'discard' as const, directory: true },
      { relativePath: 'unknown', strategy: 'warn' as const, directory: false },
    ];
    mkdirSync(join(root, 'cache'), { recursive: true });
    writeFileSync(join(root, 'discarded.txt'), 'before\n');
    execFileSync('mkfifo', [pipePath]);

    const baseline = createCompositeProfileStateBaseline(root, statePaths);
    writeFileSync(join(root, 'outside.txt'), 'reported\n');

    expect(detectCompositeProfileStateWrites(root, statePaths, baseline)).toEqual([
      { relativePath: 'outside.txt', strategy: 'warn', unknown: true },
    ]);

    const unfilteredBaseline = createCompositeProfileStateBaseline(root);
    writeFileSync(join(root, 'discarded.txt'), 'after\n');
    expect(
      detectCompositeProfileStateWrites(
        root,
        [{ relativePath: 'discarded.txt', strategy: 'discard', directory: false }],
        unfilteredBaseline,
      ),
    ).toEqual([]);
  });
});
