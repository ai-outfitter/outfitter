// Tests heavily overridden fixture behavior.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupIntegrationFixtures,
  copyFixtureToTemp,
  readExpectedJson,
  readFixtureText,
  runFixture,
  summarizePiCompositeProfile,
  compositeProfileRootFromLaunchPlan,
  tokenizeFixturePath,
} from './fixtureHarness.js';

afterEach(() => {
  cleanupIntegrationFixtures();
});

describe('heavily overridden integration fixture composite profile generation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3, OFTR-003.4, OFTR-005.3, OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges a heavily overridden engineering profile and writes back only highest-precedence owned state', async () => {
    const fixture = copyFixtureToTemp('heavily_overridden_engineering');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;
    const sourceProfilePaths = [
      'home/.outfitter/cache/repos/Z2l0K2h0dHBzOi8vZ2l0aHViLmNvbS9hY21lL2VuZ2luZWVyaW5nLXByb2ZpbGVzLmdpdCNtYWlu/profiles/engineering/profile.yml',
      'home/.outfitter/profiles/default/profile.yml',
      'home/.outfitter/profiles/engineering/profile.yml',
      'project/.outfitter/local/profiles/engineering/profile.yml',
      'project/.outfitter/profiles/engineering/profile.yml',
      'project/.outfitter/team-profiles/engineering/profile.yml',
      'project/.outfitter/team-profiles/team-baseline/profile.yml',
    ] as const;
    const originalSourceProfiles = new Map(
      sourceProfilePaths.map((profilePath) => [profilePath, readFixtureText(fixture, profilePath)]),
    );

    const result = await runFixture(fixture, {
      profileId: 'engineering',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'engineering',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args.map((arg) => tokenizeFixturePath(fixture, arg, compositeProfileRoot)),
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              BASE_SHARED: plan.env.BASE_SHARED,
              LOCAL_ONLY: plan.env.LOCAL_ONLY,
              PI_ONLY: plan.env.PI_ONLY,
              REMOTE_ONLY: plan.env.REMOTE_ONLY,
              REPO_ONLY: plan.env.REPO_ONLY,
              SHARED: plan.env.SHARED,
              SOURCE_ORDER: plan.env.SOURCE_ORDER,
              SUPPLEMENTAL_ONLY: plan.env.SUPPLEMENTAL_ONLY,
              TEAM_BASELINE: plan.env.TEAM_BASELINE,
              USER_ONLY: plan.env.USER_ONLY,
            },
            ...(summarizePiCompositeProfile(fixture, compositeProfileRoot) as Record<string, unknown>),
          };

          writeFileSync(join(compositeProfileRoot, 'outfitter', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"owner":"project-local","version":2}\n');
          writeFileSync(join(compositeProfileRoot, 'unexpected-local.txt'), 'unknown write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(result.profileId).toBe('engineering');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(
      readFileSync(
        join(fixture.project, '.outfitter', 'local', 'profiles', 'engineering', 'cli_specific', 'pi', 'settings.json'),
        'utf8',
      ),
    ).toBe('{"owner":"project-local","version":2}\n');
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe(
      '{ "owner": "native-fallback" }\n',
    );
    for (const [profilePath, originalProfileYaml] of originalSourceProfiles) {
      expect(readFixtureText(fixture, profilePath)).toBe(originalProfileYaml);
    }
  });
});
