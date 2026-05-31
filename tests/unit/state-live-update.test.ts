// Tests state-write accounting when live tack updates regenerate files.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { createTack } from '../../src/tack/Tack.js';
import {
  createTackStateBaseline,
  detectTackStateWrites,
  updateTackStateBaselinePaths,
} from '../../src/tack/StatePersistence.js';
import { createTackFile } from '../../src/tack/TackFile.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-state-live-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.bridl'), { recursive: true });
  writeFileSync(join(homeDirectory, '.bridl', 'settings.yml'), content);
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

describe('live tack update state accounting', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.4, BRIDL-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not report live-regenerated tack files as agent state writes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.bridl', 'profiles');
    const profilePath = writeProfile(profilesDirectory, 'default', 'id: default\nlabel: Initial\ncontrols: {}\n');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        adapter: {
          id: 'mock-agent',
          supportedControls: [],
          createTack(profile, tackInput) {
            return {
              tack: createTack(
                tackInput.rootDirectory,
                [
                  createTackFile({
                    relativePath: 'generated.txt',
                    content: `${profile.label}\n`,
                    sourceInputs: tackInput.profilePaths,
                  }),
                ],
                [{ relativePath: 'unknown', strategy: 'warn', directory: false }],
              ),
              warnings: [],
            };
          },
          createLaunchPlan(tack) {
            return { command: 'mock-agent', args: [], env: { MOCK_AGENT_DIR: tack.rootDirectory } };
          },
          getUnsupportedControls() {
            return [];
          },
        },
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
    const baseline = createTackStateBaseline(root);

    rmSync(generatedPath);
    const updatedBaseline = updateTackStateBaselinePaths(root, baseline, ['generated.txt']);

    expect(
      detectTackStateWrites(root, [{ relativePath: 'unknown', strategy: 'warn', directory: false }], baseline),
    ).toEqual([{ relativePath: 'generated.txt', strategy: 'warn', unknown: true }]);
    expect(
      detectTackStateWrites(root, [{ relativePath: 'unknown', strategy: 'warn', directory: false }], updatedBaseline),
    ).toEqual([]);
  });
});
