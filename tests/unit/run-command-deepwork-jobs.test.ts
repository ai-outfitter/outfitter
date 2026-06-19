// Tests profile-bundled Pi resource exposure during run command launches.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-deepwork-jobs-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): string => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  const profilePath = join(profileDirectory, 'profile.yml');
  writeFileSync(profilePath, content);
  return profileDirectory;
};

const writeDeepWorkJob = (profileDirectory: string, jobName: string): string => {
  const jobsFolder = join(profileDirectory, 'cli_specific', 'pi', 'deepwork', 'jobs');
  mkdirSync(join(jobsFolder, jobName), { recursive: true });
  writeFileSync(join(jobsFolder, jobName, 'job.yml'), `name: ${jobName}\nsummary: ${jobName}\n`);
  return jobsFolder;
};

const writePiSkill = (profileDirectory: string, skillName: string): string => {
  const skillFolder = join(profileDirectory, 'cli_specific', 'pi', 'skills', skillName);
  mkdirSync(skillFolder, { recursive: true });
  writeFileSync(join(skillFolder, 'SKILL.md'), `---\nname: ${skillName}\ndescription: ${skillName}\n---\n`);
  return skillFolder;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('run command profile-bundled Pi resource exposure', () => {
  it('exposes selected profile-bundled DeepWork jobs when launching pi', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
    const baseProfileDirectory = writeProfile(profilesDirectory, 'base', 'id: base\ncontrols: {}\n');
    const selectedProfileDirectory = writeProfile(
      profilesDirectory,
      'default',
      [
        'id: default',
        'inherits: [base]',
        'controls:',
        '  environment:',
        '    DEEPWORK_ADDITIONAL_JOBS_FOLDERS: /existing/jobs',
        '',
      ].join('\n'),
    );
    const unrelatedProfileDirectory = writeProfile(profilesDirectory, 'unrelated', 'id: unrelated\ncontrols: {}\n');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');

    const baseJobsFolder = writeDeepWorkJob(baseProfileDirectory, 'metric_audit');
    const selectedJobsFolder = writeDeepWorkJob(selectedProfileDirectory, 'insight_brief');
    const unrelatedJobsFolder = writeDeepWorkJob(unrelatedProfileDirectory, 'should_not_load');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
        writeLine: () => undefined,
      },
    );

    expect(result.launchPlan.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).toBe(
      [baseJobsFolder, selectedJobsFolder].join(delimiter),
    );
    expect(result.launchPlan.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).not.toContain(unrelatedJobsFolder);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('exposes selected profile-bundled Pi skills when launching pi', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
    const selectedProfileDirectory = writeProfile(
      profilesDirectory,
      'data_analyst',
      'id: data_analyst\ncontrols: {}\n',
    );
    const unrelatedProfileDirectory = writeProfile(profilesDirectory, 'engineer', 'id: engineer\ncontrols: {}\n');
    writeSettings(homeDirectory, 'default_profile: data_analyst\nprofile_sources:\n  - path: ./profiles\n');

    const demosSkillFolder = writePiSkill(selectedProfileDirectory, 'demos');
    const unrelatedSkillFolder = writePiSkill(unrelatedProfileDirectory, 'shipit');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
        writeLine: () => undefined,
      },
    );

    expect(result.launchPlan.args).toContain('--skill');
    expect(result.launchPlan.args).toContain(demosSkillFolder);
    expect(result.launchPlan.args).not.toContain(unrelatedSkillFolder);
  });

  it('resolves an analysis alias to data analyst bundled jobs', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
    const dataAnalystProfileDirectory = writeProfile(
      profilesDirectory,
      'data_analyst',
      'id: data_analyst\nlabel: Data Analyst\ncontrols: {}\n',
    );
    writeProfile(
      profilesDirectory,
      'analysis',
      ['id: analysis', 'label: Analysis', 'inherits:', '  - data_analyst', 'controls: {}', ''].join('\n'),
    );
    writeSettings(homeDirectory, 'default_profile: data_analyst\nprofile_sources:\n  - path: ./profiles\n');

    const jobsFolder = writeDeepWorkJob(dataAnalystProfileDirectory, 'finder_analysis');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, profileId: 'analysis' },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
        writeLine: () => undefined,
      },
    );

    expect(result.profileId).toBe('analysis');
    expect(result.launchPlan.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).toBe(jobsFolder);
  });
});
