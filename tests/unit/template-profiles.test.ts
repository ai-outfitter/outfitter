// Tests template profile behavior across loading, listing, resolution, and launch selection.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-template-profiles-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): void => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('template profiles', () => {
  it('rejects directly selected template profiles but allows inheriting them', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
    writeSettings(homeDirectory, 'default_profile: prose\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      profilesDirectory,
      'prose',
      'id: prose\ntemplate: true\ncontrols:\n  append_system_prompt: prose.md\n',
    );
    writeProfile(
      profilesDirectory,
      'project-lead',
      'id: project-lead\ninherits: [prose]\ncontrols:\n  append_system_prompt: lead.md\n',
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("Profile 'prose' is a template profile");
    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, profileId: 'prose' },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("Profile 'prose' is a template profile");

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, profileId: 'project-lead' },
      {
        writeLine: () => undefined,
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('project-lead');
    expect(result.launchPlan.args).toEqual(['--append-system-prompt', 'lead.md', '--append-system-prompt', 'prose.md']);
  });
});
