// Tests fixture-backed integration behavior for tack generation and state ownership.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupIntegrationFixtures,
  copyFixtureToTemp,
  readExpectedJson,
  readFixtureText,
  runFixture,
  summarizePiTack,
  tackRootFromLaunchPlan,
  tokenizeFixturePath,
} from './fixtureHarness.js';

afterEach(() => {
  cleanupIntegrationFixtures();
});

describe('integration fixture tack generation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.3, BRIDL-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs a repo-only selected profile over the user default and uses native fallback state', async () => {
    const fixture = copyFixtureToTemp('trivial_repo_only_profile');
    const warnings: string[] = [];
    let tackSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'repo-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const tackRoot = tackRootFromLaunchPlan(plan);
          tackSummary = {
            profileId: 'repo-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, tackRoot),
              REPO_PROFILE: plan.env.REPO_PROFILE,
              SHARED_LAYER: plan.env.SHARED_LAYER,
              USER_DEFAULT: plan.env.USER_DEFAULT,
            },
            ...(summarizePiTack(fixture, tackRoot) as Record<string, unknown>),
          };

          writeFileSync(join(tackRoot, 'bridl', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(tackRoot, 'settings.json'), '{"fallback":"updated"}\n');
          writeFileSync(join(tackRoot, 'unexpected.txt'), 'unknown write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(tackSummary).toEqual(readExpectedJson(fixture, 'pi/tack-summary.json'));
    expect(result.profileId).toBe('repo-review');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe('{"fallback":"updated"}\n');
    expect(readFixtureText(fixture, 'home/.bridl/profiles/default/profile.yml')).toContain('USER_DEFAULT');
    expect(readFixtureText(fixture, 'project/.bridl/profiles/repo-review/profile.yml')).toContain('REPO_PROFILE');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-003.2, BRIDL-REQ-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs a realistic TypeScript profile stack over the user default without writing back inherited profiles', async () => {
    const fixture = copyFixtureToTemp('language_stack_with_personal_default');
    const warnings: string[] = [];
    let tackSummary: unknown;
    const inheritedProfilePaths = [
      'home/.bridl/profiles/default/profile.yml',
      'project/.bridl/profiles/repo-review-base/profile.yml',
      'project/.bridl/profiles/language-typescript/profile.yml',
      'project/.bridl/profiles/tooling-node-vitest/profile.yml',
    ] as const;
    const originalInheritedProfiles = new Map(
      inheritedProfilePaths.map((profilePath) => [profilePath, readFixtureText(fixture, profilePath)]),
    );

    const result = await runFixture(fixture, {
      profileId: 'typescript-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const tackRoot = tackRootFromLaunchPlan(plan);
          tackSummary = {
            profileId: 'typescript-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, tackRoot),
              EDITOR_STYLE: plan.env.EDITOR_STYLE,
              LANGUAGE_STACK: plan.env.LANGUAGE_STACK,
              PERSONAL_DEFAULT: plan.env.PERSONAL_DEFAULT,
              REPO_REVIEW_BASE: plan.env.REPO_REVIEW_BASE,
              REVIEW_STACK: plan.env.REVIEW_STACK,
              SELECTED_PROFILE: plan.env.SELECTED_PROFILE,
              TOOLING_STACK: plan.env.TOOLING_STACK,
            },
            ...(summarizePiTack(fixture, tackRoot) as Record<string, unknown>),
          };

          writeFileSync(join(tackRoot, 'bridl', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(tackRoot, 'settings.json'), '{"language-stack":"updated"}\n');
          writeFileSync(join(tackRoot, 'scratch.log'), 'scratch output\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(tackSummary).toEqual(readExpectedJson(fixture, 'pi/tack-summary.json'));
    expect(result.profileId).toBe('typescript-review');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe(
      '{"language-stack":"updated"}\n',
    );
    for (const [profilePath, originalProfileYaml] of originalInheritedProfiles) {
      expect(readFixtureText(fixture, profilePath)).toBe(originalProfileYaml);
    }
  });
});
