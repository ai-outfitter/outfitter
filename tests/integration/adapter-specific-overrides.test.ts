// Tests adapter-specific integration fixture behavior.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupIntegrationFixtures,
  copyFixtureToTemp,
  readExpectedJson,
  readFixtureText,
  runFixture,
  summarizeClaudeCompositeProfile,
  summarizePiCompositeProfile,
  compositeProfileRootFromLaunchPlan,
  tokenizeFixturePath,
} from './fixtureHarness.js';

afterEach(() => {
  cleanupIntegrationFixtures();
});

describe('adapter-specific integration fixture composite profile generation', () => {
  it('applies pi-specific controls and writes back only pi profile-owned state', async () => {
    const fixture = copyFixtureToTemp('adapter_specific_overrides');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;
    const originalSourceProfileYaml = readFixtureText(fixture, 'project/.applepi/profiles/adapter-review/profile.yml');

    const result = await runFixture(fixture, {
      profileId: 'adapter-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'adapter-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              ADAPTER_ENV: plan.env.ADAPTER_ENV,
              GENERIC_ENV: plan.env.GENERIC_ENV,
              PI_ONLY: plan.env.PI_ONLY,
              SHARED_LAYER: plan.env.SHARED_LAYER,
              USER_DEFAULT: plan.env.USER_DEFAULT,
            },
            ...(summarizePiCompositeProfile(fixture, compositeProfileRoot) as Record<string, unknown>),
          };

          writeFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"adapter":"pi","status":"updated"}\n');
          writeFileSync(join(compositeProfileRoot, 'unexpected-pi.txt'), 'unknown pi write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(result.profileId).toBe('adapter-review');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(
      readFileSync(
        join(fixture.project, '.applepi', 'profiles', 'adapter-review', 'cli_specific', 'pi', 'settings.json'),
        'utf8',
      ),
    ).toBe('{"adapter":"pi","status":"updated"}\n');
    expect(
      readFileSync(
        join(fixture.project, '.applepi', 'profiles', 'adapter-review', 'cli_specific', 'claude', 'settings.json'),
        'utf8',
      ),
    ).toBe('{ "adapter": "claude", "status": "seeded" }\n');
    expect(readFixtureText(fixture, 'project/.applepi/profiles/adapter-review/profile.yml')).toBe(
      originalSourceProfileYaml,
    );
  });

  it('applies Claude-specific controls and writes back only Claude profile-owned state', async () => {
    const fixture = copyFixtureToTemp('adapter_specific_overrides');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;
    const originalSourceProfileYaml = readFixtureText(fixture, 'project/.applepi/profiles/adapter-review/profile.yml');

    const result = await runFixture(fixture, {
      profileId: 'adapter-review',
      agentId: 'claude',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'adapter-review',
            agentId: 'claude',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              CLAUDE_CONFIG_DIR: tokenizeFixturePath(fixture, plan.env.CLAUDE_CONFIG_DIR, compositeProfileRoot),
              ADAPTER_ENV: plan.env.ADAPTER_ENV,
              CLAUDE_ONLY: plan.env.CLAUDE_ONLY,
              GENERIC_ENV: plan.env.GENERIC_ENV,
              SHARED_LAYER: plan.env.SHARED_LAYER,
              USER_DEFAULT: plan.env.USER_DEFAULT,
            },
            ...(summarizeClaudeCompositeProfile(fixture, compositeProfileRoot) as Record<string, unknown>),
          };

          writeFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"adapter":"claude","status":"updated"}\n');
          writeFileSync(join(compositeProfileRoot, 'unexpected-claude.txt'), 'unknown claude write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'claude/composite-profile-summary.json'));
    expect(result.profileId).toBe('adapter-review');
    expect(result.agentId).toBe('claude');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'claude/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(
      readFileSync(
        join(fixture.project, '.applepi', 'profiles', 'adapter-review', 'cli_specific', 'claude', 'settings.json'),
        'utf8',
      ),
    ).toBe('{"adapter":"claude","status":"updated"}\n');
    expect(
      readFileSync(
        join(fixture.project, '.applepi', 'profiles', 'adapter-review', 'cli_specific', 'pi', 'settings.json'),
        'utf8',
      ),
    ).toBe('{ "adapter": "pi", "status": "seeded" }\n');
    expect(readFixtureText(fixture, 'project/.applepi/profiles/adapter-review/profile.yml')).toBe(
      originalSourceProfileYaml,
    );
  });
});
