// Tests profile-bundled Claude skills and subagents aggregated into the composite profile.
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createClaudeAdapter } from '../../src/agents/claude/ClaudeAdapter.js';
import { resolveClaudeStateEntrySources } from '../../src/agents/claude/ClaudeProfileResources.js';
import { writeCompositeProfile } from '../../src/compositeProfile/CompositeProfileAssembler.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (prefix: string): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

const writeSkill = (skillsFolder: string, name: string): string => {
  const skillFolder = join(skillsFolder, name);
  mkdirSync(skillFolder, { recursive: true });
  writeFileSync(join(skillFolder, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n`);
  return skillFolder;
};

const writeSubagent = (agentsFolder: string, fileName: string, content: string): string => {
  mkdirSync(agentsFolder, { recursive: true });
  const agentPath = join(agentsFolder, fileName);
  writeFileSync(agentPath, content);
  return agentPath;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('claude adapter profile resources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.8, OFTR-006.5.10, OFTR-006.5.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('aggregates profile-bundled skills with home skills into a merged composite skills directory', () => {
    const root = createTemporaryRoot('outfitter-claude-profile-skills-');
    const homeDirectory = join(root, 'home');
    const profileFolder = join(root, 'profiles', 'reviewer');
    const homeSkillFolder = writeSkill(join(homeDirectory, '.claude', 'skills'), 'personal-skill');
    writeSkill(join(homeDirectory, '.claude', 'skills'), 'review');
    const profileSkillFolder = writeSkill(join(profileFolder, 'skills'), 'review');
    mkdirSync(join(profileFolder, 'skills', 'not-a-skill'), { recursive: true });
    writeFileSync(join(profileFolder, 'skills', 'stray-file.md'), 'not a skill directory\n');

    const adapter = createClaudeAdapter();
    const compositeRoot = join(root, 'composite');
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'reviewer', inherits: [], controls: {} },
      { rootDirectory: compositeRoot, profilePaths: [], profileFolders: [profileFolder], homeDirectory },
    );

    const skillsStatePath = compositeProfilePlan.compositeProfile.statePaths.find(
      (statePath) => statePath.relativePath === 'skills/',
    );
    expect(skillsStatePath).toMatchObject({ strategy: 'symlink', sourcePath: undefined });
    expect(skillsStatePath?.entrySources).toEqual([
      { name: 'personal-skill', sourcePath: homeSkillFolder, directory: true },
      { name: 'review', sourcePath: profileSkillFolder, directory: true },
    ]);

    writeCompositeProfile(compositeProfilePlan.compositeProfile);

    expect(lstatSync(join(compositeRoot, 'skills')).isDirectory()).toBe(true);
    expect(lstatSync(join(compositeRoot, 'skills')).isSymbolicLink()).toBe(false);
    expect(readlinkSync(join(compositeRoot, 'skills', 'review'))).toBe(profileSkillFolder);
    expect(readlinkSync(join(compositeRoot, 'skills', 'personal-skill'))).toBe(homeSkillFolder);

    writeFileSync(join(compositeRoot, 'skills', 'review', 'SKILL.md'), 'updated skill\n');
    expect(readFileSync(join(profileSkillFolder, 'SKILL.md'), 'utf8')).toBe('updated skill\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.9, OFTR-006.5.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('aggregates profile-bundled subagents with home subagents and lets later profile layers win', () => {
    const root = createTemporaryRoot('outfitter-claude-profile-agents-');
    const homeDirectory = join(root, 'home');
    const baseFolder = join(root, 'profiles', 'team-base');
    const profileFolder = join(root, 'profiles', 'reviewer');
    const homeAgentPath = writeSubagent(join(homeDirectory, '.claude', 'agents'), 'personal.md', '# Personal agent\n');
    writeSubagent(join(homeDirectory, '.claude', 'agents'), 'reviewer.md', '# Home reviewer\n');
    writeSubagent(join(baseFolder, 'agents'), 'reviewer.md', '# Base reviewer\n');
    const profileAgentPath = writeSubagent(join(profileFolder, 'agents'), 'reviewer.md', '# Profile reviewer\n');
    mkdirSync(join(profileFolder, 'agents', 'not-an-agent'), { recursive: true });
    writeSubagent(join(profileFolder, 'agents'), 'notes.txt', 'not markdown\n');

    const adapter = createClaudeAdapter();
    const compositeRoot = join(root, 'composite');
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'reviewer', inherits: ['team-base'], controls: {} },
      { rootDirectory: compositeRoot, profilePaths: [], profileFolders: [baseFolder, profileFolder], homeDirectory },
    );

    const agentsStatePath = compositeProfilePlan.compositeProfile.statePaths.find(
      (statePath) => statePath.relativePath === 'agents/',
    );
    expect(agentsStatePath?.entrySources).toEqual([
      { name: 'personal.md', sourcePath: homeAgentPath, directory: false },
      { name: 'reviewer.md', sourcePath: profileAgentPath, directory: false },
    ]);

    writeCompositeProfile(compositeProfilePlan.compositeProfile);

    expect(readFileSync(join(compositeRoot, 'agents', 'reviewer.md'), 'utf8')).toBe('# Profile reviewer\n');
    expect(readFileSync(join(compositeRoot, 'agents', 'personal.md'), 'utf8')).toBe('# Personal agent\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.8, OFTR-006.5.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps whole-directory symlinks when no contributing profile ships generic skills or subagents', () => {
    const root = createTemporaryRoot('outfitter-claude-no-resources-');
    const homeDirectory = join(root, 'home');
    const profileFolder = join(root, 'profiles', 'plain');
    mkdirSync(profileFolder, { recursive: true });

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'plain', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder], homeDirectory },
    );

    for (const relativePath of ['skills/', 'agents/']) {
      const statePath = compositeProfilePlan.compositeProfile.statePaths.find(
        (candidate) => candidate.relativePath === relativePath,
      );
      expect(statePath).toMatchObject({
        strategy: 'symlink',
        sourcePath: join(homeDirectory, '.claude', relativePath.slice(0, -1)),
      });
      expect(statePath?.entrySources).toBeUndefined();
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges generic profile skills with claude-specific profile skill state instead of home state', () => {
    const root = createTemporaryRoot('outfitter-claude-cli-specific-skills-');
    const homeDirectory = join(root, 'home');
    const profileFolder = join(root, 'profiles', 'owner');
    const cliSpecificSkillFolder = writeSkill(join(profileFolder, 'cli_specific', 'claude', 'skills'), 'owned-skill');
    const genericSkillFolder = writeSkill(join(profileFolder, 'skills'), 'shared-skill');
    writeSkill(join(homeDirectory, '.claude', 'skills'), 'hidden-home-skill');

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'owner', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder], homeDirectory },
    );

    const skillsStatePath = compositeProfilePlan.compositeProfile.statePaths.find(
      (statePath) => statePath.relativePath === 'skills/',
    );
    expect(skillsStatePath?.entrySources).toEqual([
      { name: 'owned-skill', sourcePath: cliSpecificSkillFolder, directory: true },
      { name: 'shared-skill', sourcePath: genericSkillFolder, directory: true },
    ]);
  });

  it('respects state_persistence overrides for aggregated skill and agent directories', () => {
    const root = createTemporaryRoot('outfitter-claude-discarded-skills-');
    const homeDirectory = join(root, 'home');
    const profileFolder = join(root, 'profiles', 'discarding');
    writeSkill(join(profileFolder, 'skills'), 'ignored-skill');

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'discarding', inherits: [], controls: {}, statePersistence: { 'skills/': 'discard' } },
      { rootDirectory: join(root, 'composite'), profilePaths: [], profileFolders: [profileFolder], homeDirectory },
    );

    const skillsStatePath = compositeProfilePlan.compositeProfile.statePaths.find(
      (statePath) => statePath.relativePath === 'skills/',
    );
    expect(skillsStatePath).toMatchObject({ strategy: 'discard', sourcePath: undefined });
    expect(skillsStatePath?.entrySources).toBeUndefined();
  });

  it('surfaces append_system_prompt include diagnostics as composite profile warnings', () => {
    const root = createTemporaryRoot('outfitter-claude-prompt-include-');
    const profileFolder = join(root, 'profiles', 'prompted');
    mkdirSync(profileFolder, { recursive: true });
    const profile = {
      id: 'prompted',
      inherits: [],
      controls: { appendSystemPrompt: { file: 'prompts/missing.md' } },
    };

    const adapter = createClaudeAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(profile, {
      rootDirectory: join(root, 'composite'),
      profilePaths: [],
      profileFolders: [profileFolder],
      profileLayers: [
        {
          profile,
          profilePath: join(profileFolder, 'profile.yml'),
          sourceRootPath: join(root, 'profiles'),
          resourceRootPath: profileFolder,
          layout: 'directory',
        },
      ],
    });

    expect(compositeProfilePlan.warnings).toEqual([
      expect.stringContaining("claude Prompt file include 'prompts/missing.md' was not found."),
    ]);
  });

  it('reports unreadable profile resource folders with an actionable error', () => {
    const root = createTemporaryRoot('outfitter-claude-unreadable-skills-');
    const profileFolder = join(root, 'profiles', 'broken');
    mkdirSync(profileFolder, { recursive: true });
    writeFileSync(join(profileFolder, 'skills'), 'a file where the skills folder should be\n');

    expect(() =>
      resolveClaudeStateEntrySources({
        relativePath: 'skills/',
        profileFolders: [profileFolder],
        baseSourcePath: join(root, 'home', '.claude', 'skills'),
      }),
    ).toThrow('Could not read profile skills folder');
  });
});
