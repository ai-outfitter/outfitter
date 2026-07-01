// Tests profile-bundled launch resource integration fixture behavior for the claude adapter.
import { lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupIntegrationFixtures,
  copyFixtureToTemp,
  readExpectedJson,
  runFixture,
  compositeProfileRootFromLaunchPlan,
  tokenizeFixturePath,
} from './fixtureHarness.js';

afterEach(() => {
  cleanupIntegrationFixtures();
});

describe('profile-bundled agent resource integration fixture composite profile generation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges inherited and selected claude MCP fragments and loads them through --mcp-config', async () => {
    const fixture = copyFixtureToTemp('profile_bundled_agent_resources');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'resource-review',
      agentId: 'claude',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'resource-review',
            agentId: 'claude',
            launchCommand: plan.command,
            launchArgs: plan.args.map((arg) => tokenizeFixturePath(fixture, arg, compositeProfileRoot)),
            launchEnv: {
              CLAUDE_CONFIG_DIR: tokenizeFixturePath(fixture, plan.env.CLAUDE_CONFIG_DIR, compositeProfileRoot),
              RESOURCE_BASE: plan.env.RESOURCE_BASE,
              SELECTED_PROFILE: plan.env.SELECTED_PROFILE,
              SHARED_LAYER: plan.env.SHARED_LAYER,
            },
            generatedProfile: JSON.parse(
              readFileSync(join(compositeProfileRoot, 'outfitter', 'profile.json'), 'utf8'),
            ) as unknown,
            mcpConfig: JSON.parse(readFileSync(join(compositeProfileRoot, '.mcp.json'), 'utf8')) as unknown,
          };

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'claude/composite-profile-summary.json'));
    expect(result.profileId).toBe('resource-review');
    expect(result.agentId).toBe('claude');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'claude/warnings.json'));
    expect(warnings).toEqual(result.warnings);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes inherited, selected, and personal skills into the claude composite skills directory', async () => {
    const fixture = copyFixtureToTemp('profile_bundled_agent_resources');
    const warnings: string[] = [];
    let skillsSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'resource-review',
      agentId: 'claude',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          const skillsDirectory = join(compositeProfileRoot, 'skills');
          const skillEntries = readdirSync(skillsDirectory).sort();

          expect(lstatSync(skillsDirectory).isSymbolicLink()).toBe(false);
          skillsSummary = {
            profileId: 'resource-review',
            agentId: 'claude',
            skillsDirectoryEntries: skillEntries,
            skillTargets: Object.fromEntries(
              skillEntries.map((skillName) => [
                skillName,
                tokenizeFixturePath(fixture, readlinkSync(join(skillsDirectory, skillName)), compositeProfileRoot),
              ]),
            ),
          };

          mkdirSync(join(skillsDirectory, 'session-created-skill'));
          writeFileSync(join(skillsDirectory, 'session-created-skill', 'SKILL.md'), '# Session skill\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(skillsSummary).toEqual(readExpectedJson(fixture, 'claude/skills-summary.json'));
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'claude/skills-warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(
      readFileSync(
        join(fixture.project, '.outfitter', 'profiles', 'resource-review', 'skills', 'changelog-writer', 'SKILL.md'),
        'utf8',
      ),
    ).toContain('Selected changelog writing guidance.');
  });
});
