// Tests profile-owned CLI state integration fixture behavior.
import { readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanupIntegrationFixtures,
  copyFixtureToTemp,
  readExpectedJson,
  readFixtureText,
  runFixture,
  compositeProfileRootFromLaunchPlan,
  tokenizeFixturePath,
} from './fixtureHarness.js';

afterEach(() => {
  cleanupIntegrationFixtures();
});

describe('profile-owned CLI state integration fixture composite profile generation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.3, APPLEPI-REQ-005.6, APPLEPI-REQ-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses pi state owned by the selected profile and writes through declared symlinks', async () => {
    const fixture = copyFixtureToTemp('profile_owned_cli_state');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'stateful-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'stateful-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              PERSONAL_DEFAULT: plan.env.PERSONAL_DEFAULT,
              TEAM_BASE: plan.env.TEAM_BASE,
              SELECTED_PROFILE: plan.env.SELECTED_PROFILE,
              PI_PROFILE_STATE: plan.env.PI_PROFILE_STATE,
              SHARED_LAYER: plan.env.SHARED_LAYER,
            },
            generatedProfile: JSON.parse(
              readFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), 'utf8'),
            ) as unknown,
            mcpConfig: JSON.parse(readFileSync(join(compositeProfileRoot, '.mcp.json'), 'utf8')) as unknown,
            stateTargets: {
              'auth.json': tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'auth.json')),
                compositeProfileRoot,
              ),
              'settings.json': tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'settings.json')),
                compositeProfileRoot,
              ),
              'mcp.json': tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'mcp.json')),
                compositeProfileRoot,
              ),
              plugins: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'plugins')),
                compositeProfileRoot,
              ),
              utilities: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'utilities')),
                compositeProfileRoot,
              ),
            },
          };

          writeFileSync(join(compositeProfileRoot, 'auth.json'), '{"token":"updated-pi-token"}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"profile":"updated-pi-settings"}\n');
          writeFileSync(join(compositeProfileRoot, 'plugins', 'repo-plugin.json'), '{"name":"updated-pi-plugin"}\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(result.profileId).toBe('stateful-review');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(readFixtureText(fixture, 'project/.applepi/profiles/stateful-review/cli_specific/pi/auth.json')).toBe(
      '{"token":"updated-pi-token"}\n',
    );
    expect(readFixtureText(fixture, 'project/.applepi/profiles/stateful-review/cli_specific/pi/settings.json')).toBe(
      '{"profile":"updated-pi-settings"}\n',
    );
    expect(
      readFixtureText(fixture, 'project/.applepi/profiles/stateful-review/cli_specific/pi/plugins/repo-plugin.json'),
    ).toBe('{"name":"updated-pi-plugin"}\n');
    expect(
      readFixtureText(fixture, 'project/.applepi/profiles/stateful-review/cli_specific/claude/settings.json'),
    ).toBe('{ "profile": "claude-settings", "permissions": "review" }\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.3, APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses claude state owned by the selected profile without touching pi state', async () => {
    const fixture = copyFixtureToTemp('profile_owned_cli_state');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'stateful-review',
      agentId: 'claude',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'stateful-review',
            agentId: 'claude',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              CLAUDE_CONFIG_DIR: tokenizeFixturePath(fixture, plan.env.CLAUDE_CONFIG_DIR, compositeProfileRoot),
              PERSONAL_DEFAULT: plan.env.PERSONAL_DEFAULT,
              TEAM_BASE: plan.env.TEAM_BASE,
              SELECTED_PROFILE: plan.env.SELECTED_PROFILE,
              CLAUDE_PROFILE_STATE: plan.env.CLAUDE_PROFILE_STATE,
              SHARED_LAYER: plan.env.SHARED_LAYER,
            },
            generatedProfile: JSON.parse(
              readFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), 'utf8'),
            ) as unknown,
            stateTargets: {
              'settings.json': tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'settings.json')),
                compositeProfileRoot,
              ),
              agents: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'agents')),
                compositeProfileRoot,
              ),
              commands: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'commands')),
                compositeProfileRoot,
              ),
              skills: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'skills')),
                compositeProfileRoot,
              ),
              plugins: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'plugins')),
                compositeProfileRoot,
              ),
            },
          };

          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"profile":"updated-claude-settings"}\n');
          writeFileSync(join(compositeProfileRoot, 'agents', 'reviewer.md'), '# Updated Reviewer Agent\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'claude/composite-profile-summary.json'));
    expect(result.profileId).toBe('stateful-review');
    expect(result.agentId).toBe('claude');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'claude/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(
      readFixtureText(fixture, 'project/.applepi/profiles/stateful-review/cli_specific/claude/settings.json'),
    ).toBe('{"profile":"updated-claude-settings"}\n');
    expect(
      readFixtureText(fixture, 'project/.applepi/profiles/stateful-review/cli_specific/claude/agents/reviewer.md'),
    ).toBe('# Updated Reviewer Agent\n');
    expect(readFixtureText(fixture, 'project/.applepi/profiles/stateful-review/cli_specific/pi/settings.json')).toBe(
      '{ "profile": "pi-settings", "theme": "stateful" }\n',
    );
  });
});
