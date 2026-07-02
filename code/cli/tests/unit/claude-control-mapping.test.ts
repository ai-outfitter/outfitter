// Tests Claude Code control mapping completeness: effort translation, roadmap warnings, and strict escalation.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeAdapter } from '../../src/agents/claude/ClaudeAdapter.js';
import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-claude-controls-'));
  temporaryRoots.push(root);
  return root;
};

const setupRunHome = (profileYaml: string): { homeDirectory: string; projectDirectory: string } => {
  const root = createTemporaryRoot();
  const homeDirectory = join(root, 'home');
  const projectDirectory = join(root, 'project');
  const profileDirectory = join(homeDirectory, '.outfitter', 'profiles', 'default');
  mkdirSync(profileDirectory, { recursive: true });
  mkdirSync(projectDirectory, { recursive: true });
  writeFileSync(
    join(homeDirectory, '.outfitter', 'settings.yml'),
    'default_profile: default\nprofile_sources:\n  - path: ./profiles\n',
  );
  writeFileSync(join(profileDirectory, 'profile.yml'), profileYaml);
  return { homeDirectory, projectDirectory };
};

const createCompositePlan = (controls: Record<string, unknown>) => {
  const adapter = createClaudeAdapter();
  return adapter.createCompositeProfile(
    { id: 'mapping', inherits: [], controls },
    { rootDirectory: join(createTemporaryRoot(), 'composite'), profilePaths: [] },
  );
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('Claude Code adapter control mapping completeness', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('maps each generic thinking level onto a documented Claude --effort level', () => {
    const adapter = createClaudeAdapter();
    const compositeProfile = createCompositePlan({}).compositeProfile;
    const effortFor = (thinking: string): readonly string[] =>
      adapter.createLaunchPlan(compositeProfile, { id: 'mapping', inherits: [], controls: { thinking } }).args;

    expect(effortFor('off')).toEqual(['--effort', 'low']);
    expect(effortFor('minimal')).toEqual(['--effort', 'low']);
    expect(effortFor('low')).toEqual(['--effort', 'low']);
    expect(effortFor('medium')).toEqual(['--effort', 'medium']);
    expect(effortFor('high')).toEqual(['--effort', 'high']);
    expect(effortFor('xhigh')).toEqual(['--effort', 'xhigh']);
    expect(effortFor('max')).toEqual(['--effort', 'max']);
    expect(effortFor('deep')).toEqual(['--effort', 'deep']);
    expect(adapter.createLaunchPlan(compositeProfile, { id: 'mapping', inherits: [], controls: {} }).args).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns with accurate text for each roadmap control the claude adapter cannot translate', () => {
    expect(createCompositePlan({ provider: 'anthropic' }).warnings).toEqual([
      "claude adapter cannot translate requested control 'provider'.",
    ]);
    expect(createCompositePlan({ prompt_template: 'team-template' }).warnings).toEqual([
      "claude adapter cannot translate requested control 'prompt_template'.",
    ]);
    expect(createCompositePlan({ promptTemplate: 'team-template' }).warnings).toEqual([
      "claude adapter cannot translate requested control 'promptTemplate'.",
    ]);
    expect(createCompositePlan({ deepwork: { jobs: ['triage'] } }).warnings).toEqual([
      "claude adapter cannot translate requested control 'deepwork'.",
    ]);
    expect(createCompositePlan({ tools: ['Bash'] }).warnings).toEqual([
      "claude adapter cannot translate requested control 'tools'.",
    ]);
    expect(createCompositePlan({ claude: { deepwork: { jobs: ['triage'] } } }).warnings).toEqual([
      "claude adapter cannot translate requested control 'claude.deepwork'.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.5, OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('escalates every untranslatable claude control warning to a failure under strict', async () => {
    const strictCases = [
      {
        profileYaml: 'id: default\ncontrols:\n  deepwork:\n    jobs: [triage]\n',
        message: "Strict failed for claude: claude adapter cannot translate requested control 'deepwork'.",
      },
      {
        profileYaml: 'id: default\ncontrols:\n  prompt_template: team-template\n',
        message: "Strict failed for claude: claude adapter cannot translate requested control 'prompt_template'.",
      },
      {
        profileYaml: 'id: default\ncontrols:\n  tools: [Bash]\n',
        message: "Strict failed for claude: claude adapter cannot translate requested control 'tools'.",
      },
      {
        profileYaml: 'id: default\ncontrols:\n  skills: [missing-skill]\n',
        message: "Strict failed for claude: claude adapter could not find skill 'missing-skill' for profile 'default'.",
      },
    ];

    for (const strictCase of strictCases) {
      const { homeDirectory, projectDirectory } = setupRunHome(strictCase.profileYaml);

      await expect(
        executeRunCommand(
          { homeDirectory, projectDirectory, agentId: 'claude', strict: true },
          {
            launcher: {
              launch() {
                return Promise.resolve(0);
              },
            },
          },
        ),
      ).rejects.toThrow(strictCase.message);
    }
  });
});
