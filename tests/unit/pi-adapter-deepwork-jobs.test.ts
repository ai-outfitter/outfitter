// Tests Pi adapter profile-bundled DeepWork job exposure.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';

const temporaryPiAdapterTestRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryPiAdapterTestRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi adapter DeepWork jobs', () => {
  it('adds only selected profile-bundled DeepWork jobs to the pi launch environment by default', () => {
    const root = mkdtempSync(join(tmpdir(), 'applepi-pi-deepwork-jobs-'));
    temporaryPiAdapterTestRoots.push(root);
    const baseProfileFolder = join(root, 'base');
    const selectedProfileFolder = join(root, 'selected');
    const unrelatedProfileFolder = join(root, 'unrelated');
    const invalidProfileFolder = join(root, 'invalid');
    const missingProfileFolder = join(root, 'missing');
    const baseJobsFolder = join(baseProfileFolder, 'cli_specific', 'pi', 'deepwork', 'jobs');
    const selectedJobsFolder = join(selectedProfileFolder, 'cli_specific', 'pi', 'deepwork', 'jobs');
    const unrelatedJobsFolder = join(unrelatedProfileFolder, 'cli_specific', 'pi', 'deepwork', 'jobs');
    const invalidJobsFolder = join(invalidProfileFolder, 'cli_specific', 'pi', 'deepwork', 'jobs');

    mkdirSync(join(baseJobsFolder, 'metric_audit'), { recursive: true });
    mkdirSync(join(selectedJobsFolder, 'insight_brief'), { recursive: true });
    mkdirSync(join(unrelatedJobsFolder, 'should_not_load'), { recursive: true });
    mkdirSync(join(invalidJobsFolder, 'empty_job'), { recursive: true });
    writeFileSync(join(baseJobsFolder, 'metric_audit', 'job.yml'), 'name: metric_audit\nsummary: Metric audit\n');
    writeFileSync(
      join(selectedJobsFolder, 'insight_brief', 'job.yml'),
      'name: insight_brief\nsummary: Insight brief\n',
    );
    writeFileSync(join(unrelatedJobsFolder, 'should_not_load', 'job.yml'), 'name: should_not_load\nsummary: No\n');
    writeFileSync(join(invalidJobsFolder, 'README.md'), 'not a job\n');

    const adapter = createPiAdapter();
    const launchPlan = adapter.createLaunchPlan(
      { rootDirectory: join(root, 'composite'), files: [], statePaths: [] },
      {
        id: 'selected',
        inherits: ['base'],
        controls: {
          environment: {
            DEEPWORK_ADDITIONAL_JOBS_FOLDERS: '/existing/jobs',
          },
        },
      },
      [],
      { profileFolders: [baseProfileFolder, selectedProfileFolder, invalidProfileFolder, missingProfileFolder] },
    );

    expect(launchPlan.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).toBe([baseJobsFolder, selectedJobsFolder].join(delimiter));
    expect(launchPlan.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).not.toContain(unrelatedJobsFolder);
    expect(launchPlan.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).not.toContain(invalidJobsFolder);
  });

  it('uses external DeepWork job folders only when the profile allows them', () => {
    const root = mkdtempSync(join(tmpdir(), 'applepi-pi-deepwork-process-env-'));
    temporaryPiAdapterTestRoots.push(root);
    const profileFolder = join(root, 'selected');
    const jobsFolder = join(profileFolder, 'cli_specific', 'pi', 'deepwork', 'jobs');
    const previousJobsFolders = process.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS;

    try {
      delete process.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS;
      mkdirSync(join(jobsFolder, 'insight_brief'), { recursive: true });
      writeFileSync(join(jobsFolder, 'insight_brief', 'job.yml'), 'name: insight_brief\nsummary: Insight brief\n');

      const adapter = createPiAdapter();
      const withoutExistingValue = adapter.createLaunchPlan(
        { rootDirectory: join(root, 'composite'), files: [], statePaths: [] },
        { id: 'selected', inherits: [], controls: {} },
        [],
        { profileFolders: [profileFolder] },
      );
      process.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS = '/process/jobs';
      const withProcessValueDisallowed = adapter.createLaunchPlan(
        { rootDirectory: join(root, 'composite'), files: [], statePaths: [] },
        { id: 'selected', inherits: [], controls: {} },
        [],
        { profileFolders: [profileFolder] },
      );
      const withProcessValueAllowed = adapter.createLaunchPlan(
        { rootDirectory: join(root, 'composite'), files: [], statePaths: [] },
        { id: 'selected', inherits: [], controls: { pi: { allow_external_deepwork_jobs: true } } },
        [],
        { profileFolders: [profileFolder] },
      );
      const withProfileValueAllowed = adapter.createLaunchPlan(
        { rootDirectory: join(root, 'composite'), files: [], statePaths: [] },
        {
          id: 'selected',
          inherits: [],
          controls: {
            environment: { DEEPWORK_ADDITIONAL_JOBS_FOLDERS: '/profile/jobs' },
            pi: { allowExternalDeepWorkJobs: true },
          },
        },
        [],
        { profileFolders: [profileFolder] },
      );

      expect(withoutExistingValue.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).toBe(jobsFolder);
      expect(withProcessValueDisallowed.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).toBe(jobsFolder);
      expect(withProcessValueAllowed.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).toBe(
        ['/process/jobs', jobsFolder].join(delimiter),
      );
      expect(withProfileValueAllowed.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS).toBe(
        ['/profile/jobs', jobsFolder].join(delimiter),
      );
    } finally {
      if (previousJobsFolders === undefined) {
        delete process.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS;
      } else {
        process.env.DEEPWORK_ADDITIONAL_JOBS_FOLDERS = previousJobsFolders;
      }
    }
  });
});
