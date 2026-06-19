// Tests strict CI integration fixture behavior.
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

describe('strict CI integration fixture composite profile generation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails a strict CI profile when declared error-state configuration changes', async () => {
    const fixture = copyFixtureToTemp('strict_ci_profile');
    const diagnostics = readExpectedJson<Record<string, string>>(fixture, 'pi/diagnostics.json');
    let launchSummary: unknown;

    await expect(
      runFixture(fixture, {
        agentId: 'pi',
        launcher: {
          launch(plan) {
            const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
            const settingsPath = join(compositeProfileRoot, 'settings.json');
            const mcpPath = join(compositeProfileRoot, 'mcp.json');
            const cachePath = join(compositeProfileRoot, 'cache');
            const sessionsPath = join(compositeProfileRoot, 'sessions');

            launchSummary = {
              profileId: 'ci-strict',
              agentId: 'pi',
              launchCommand: plan.command,
              launchArgs: plan.args,
              launchEnv: {
                PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
                OUTFITTER_FIXTURE: plan.env.OUTFITTER_FIXTURE,
                CI_PROFILE: plan.env.CI_PROFILE,
              },
              generatedProfile: JSON.parse(
                readFileSync(join(compositeProfileRoot, 'outfitter', 'profile.json'), 'utf8'),
              ) as unknown,
              strictStateFiles: {
                'settings.json': existsSync(settingsPath) ? 'present-before-launch' : 'absent-before-launch',
                'mcp.json': existsSync(mcpPath) ? 'present-before-launch' : 'absent-before-launch',
                'cache/': lstatSync(cachePath).isDirectory() ? 'directory' : 'unexpected',
                'sessions/': lstatSync(sessionsPath).isDirectory() ? 'directory' : 'unexpected',
              },
            };

            mkdirSync(join(compositeProfileRoot, 'cache'), { recursive: true });
            mkdirSync(join(compositeProfileRoot, 'sessions'), { recursive: true });
            writeFileSync(settingsPath, '{"ci":"mutated"}\n');
            writeFileSync(join(compositeProfileRoot, 'cache', 'index.json'), '{"ephemeral":true}\n');
            writeFileSync(join(compositeProfileRoot, 'sessions', 'run.json'), '{"ephemeral":true}\n');

            return Promise.resolve(0);
          },
        },
      }),
    ).rejects.toThrow(diagnostics.declaredSettingsError);

    expect(launchSummary).toEqual(readExpectedJson(fixture, 'pi/launch-summary.json'));
    expect(existsSync(join(fixture.home, '.pi', 'agent', 'settings.json'))).toBe(false);
    expect(existsSync(join(fixture.home, '.pi', 'agent', 'cache', 'index.json'))).toBe(false);
    expect(readFixtureText(fixture, 'project/.outfitter/profiles/ci-strict/profile.yml')).toContain('unknown: error');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails a strict CI profile when undeclared composite profile state is written', async () => {
    const fixture = copyFixtureToTemp('strict_ci_profile');
    const diagnostics = readExpectedJson<Record<string, string>>(fixture, 'pi/diagnostics.json');

    await expect(
      runFixture(fixture, {
        agentId: 'pi',
        launcher: {
          launch(plan) {
            const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);

            writeFileSync(join(compositeProfileRoot, 'undeclared-state.json'), '{"unexpected":true}\n');

            return Promise.resolve(0);
          },
        },
      }),
    ).rejects.toThrow(diagnostics.unknownWriteError);

    expect(existsSync(join(fixture.home, '.pi', 'agent', 'undeclared-state.json'))).toBe(false);
    expect(readFixtureText(fixture, 'project/.outfitter/profiles/ci-strict/profile.yml')).toContain(
      'settings.json: error',
    );
  });
});
