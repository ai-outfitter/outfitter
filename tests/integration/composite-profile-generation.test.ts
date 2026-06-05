/* eslint-disable max-lines */
// Tests fixture-backed integration behavior for composite profile generation and state ownership.
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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

describe('integration fixture composite profile generation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.3, APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs a repo-only selected profile over the user default and uses native fallback state', async () => {
    const fixture = copyFixtureToTemp('trivial_repo_only_profile');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'repo-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'repo-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              REPO_PROFILE: plan.env.REPO_PROFILE,
              SHARED_LAYER: plan.env.SHARED_LAYER,
              USER_DEFAULT: plan.env.USER_DEFAULT,
            },
            ...(summarizePiCompositeProfile(fixture, compositeProfileRoot) as Record<string, unknown>),
          };

          writeFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"fallback":"updated"}\n');
          writeFileSync(join(compositeProfileRoot, 'unexpected.txt'), 'unknown write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(result.profileId).toBe('repo-review');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe('{"fallback":"updated"}\n');
    expect(readFixtureText(fixture, 'home/.applepi/profiles/default/profile.yml')).toContain('USER_DEFAULT');
    expect(readFixtureText(fixture, 'project/.applepi/profiles/repo-review/profile.yml')).toContain('REPO_PROFILE');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reconciles native pi packages duplicated by profile-controlled extensions in the composite settings file', async () => {
    const fixture = copyFixtureToTemp('trivial_repo_only_profile');
    const nativeSettingsDirectory = join(fixture.home, '.pi', 'agent');
    const nativeSettingsPath = join(nativeSettingsDirectory, 'settings.json');
    const profilePath = join(fixture.project, '.applepi', 'profiles', 'repo-review', 'profile.yml');
    const warnings: string[] = [];
    let compositeSettings: unknown;
    let settingsIsSymlink = true;

    mkdirSync(nativeSettingsDirectory, { recursive: true });
    writeFileSync(
      nativeSettingsPath,
      `${JSON.stringify({ packages: ['npm:pi-subagents', 'npm:kept-package'], theme: 'dark' })}\n`,
    );
    writeFileSync(
      profilePath,
      [readFileSync(profilePath, 'utf8'), '  pi:', '    extensions:', '      - npm:pi-subagents@2', ''].join('\n'),
    );

    const result = await runFixture(fixture, {
      profileId: 'repo-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          const settingsPath = join(compositeProfileRoot, 'settings.json');
          settingsIsSymlink = lstatSync(settingsPath).isSymbolicLink();
          compositeSettings = JSON.parse(readFileSync(settingsPath, 'utf8'));
          writeFileSync(settingsPath, '{"runtime":"updated"}\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(settingsIsSymlink).toBe(false);
    expect(compositeSettings).toEqual({ packages: ['npm:kept-package'], theme: 'dark' });
    expect(readFileSync(nativeSettingsPath, 'utf8')).toBe(
      `${JSON.stringify({ packages: ['npm:pi-subagents', 'npm:kept-package'], theme: 'dark' })}\n`,
    );
    expect(result.warnings).toEqual([]);
    expect(warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-003.2, APPLEPI-REQ-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs a realistic TypeScript profile stack over the user default without writing back inherited profiles', async () => {
    const fixture = copyFixtureToTemp('language_stack_with_personal_default');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;
    const inheritedProfilePaths = [
      'home/.applepi/profiles/default/profile.yml',
      'project/.applepi/profiles/repo-review-base/profile.yml',
      'project/.applepi/profiles/language-typescript/profile.yml',
      'project/.applepi/profiles/tooling-node-vitest/profile.yml',
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
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'typescript-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              EDITOR_STYLE: plan.env.EDITOR_STYLE,
              LANGUAGE_STACK: plan.env.LANGUAGE_STACK,
              PERSONAL_DEFAULT: plan.env.PERSONAL_DEFAULT,
              REPO_REVIEW_BASE: plan.env.REPO_REVIEW_BASE,
              REVIEW_STACK: plan.env.REVIEW_STACK,
              SELECTED_PROFILE: plan.env.SELECTED_PROFILE,
              TOOLING_STACK: plan.env.TOOLING_STACK,
            },
            ...(summarizePiCompositeProfile(fixture, compositeProfileRoot) as Record<string, unknown>),
          };

          writeFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"language-stack":"updated"}\n');
          writeFileSync(join(compositeProfileRoot, 'scratch.log'), 'scratch output\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-003.1, APPLEPI-REQ-003.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses cached remote baseline settings while project-local settings select a local profile offline', async () => {
    const fixture = copyFixtureToTemp('remote_baseline_local_selection');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;

    const result = await runFixture(fixture, {
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'local-selection',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              LOCAL_SELECTION: plan.env.LOCAL_SELECTION,
              PROJECT_PROFILE: plan.env.PROJECT_PROFILE,
              REMOTE_BASELINE: plan.env.REMOTE_BASELINE,
              SHARED_BASELINE: plan.env.SHARED_BASELINE,
              SHARED_SELECTION: plan.env.SHARED_SELECTION,
              USER_DEFAULT: plan.env.USER_DEFAULT,
            },
            ...(summarizePiCompositeProfile(fixture, compositeProfileRoot) as Record<string, unknown>),
          };

          writeFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(
            join(compositeProfileRoot, 'settings.json'),
            '{"owner":"pi-write","source":"LOCAL_SELECTION"}\n',
          );
          writeFileSync(join(compositeProfileRoot, 'unexpected.txt'), 'unknown write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(result.profileId).toBe('local-selection');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(
      readFileSync(
        join(
          fixture.project,
          '.applepi',
          'local',
          'profiles',
          'local-selection',
          'cli_specific',
          'pi',
          'settings.json',
        ),
        'utf8',
      ),
    ).toBe('{"owner":"pi-write","source":"LOCAL_SELECTION"}\n');
    expect(readFixtureText(fixture, 'home/.applepi/settings.yml')).toContain('remote_settings');
    expect(readFixtureText(fixture, 'project/.applepi/settings.yml')).not.toContain('default_profile');
    expect(readFixtureText(fixture, 'project/.applepi/local/settings.yml')).toContain(
      'default_profile: local-selection',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('diagnoses declared persistent state symlinks replaced by the agent without changing sources', async () => {
    const fixture = copyFixtureToTemp('state_path_replaced_by_agent');
    const warnings: string[] = [];
    const sourceSettingsPath = join(
      fixture.project,
      '.applepi',
      'profiles',
      'state-replacement',
      'cli_specific',
      'pi',
      'settings.json',
    );
    const sourceSessionsPath = join(
      fixture.project,
      '.applepi',
      'profiles',
      'state-replacement',
      'cli_specific',
      'pi',
      'sessions',
    );

    const result = await runFixture(fixture, {
      profileId: 'state-replacement',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          const settingsPath = join(compositeProfileRoot, 'settings.json');
          const sessionsPath = join(compositeProfileRoot, 'sessions');

          expect(plan.env.REPLACEMENT_PROFILE).toBe('enabled');
          expect(plan.env.SHARED_STATE_OWNER).toBe('project-profile');
          expect(lstatSync(settingsPath).isSymbolicLink()).toBe(true);
          expect(lstatSync(sessionsPath).isSymbolicLink()).toBe(true);
          expect(readlinkSync(settingsPath)).toBe(sourceSettingsPath);
          expect(readlinkSync(sessionsPath)).toBe(sourceSessionsPath);

          unlinkSync(settingsPath);
          writeFileSync(settingsPath, '{"agent":"replaced symlink with file"}\n');
          unlinkSync(sessionsPath);
          mkdirSync(sessionsPath);
          writeFileSync(join(sessionsPath, 'replacement.log'), 'agent replaced symlink with directory\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(result.profileId).toBe('state-replacement');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(readFileSync(sourceSettingsPath, 'utf8')).toBe('{ "profileOwned": "unchanged", "theme": "dark" }\n');
    expect(readFileSync(join(sourceSessionsPath, 'session.txt'), 'utf8')).toBe(
      'profile-owned session remains unchanged\n',
    );
    expect(readFixtureText(fixture, 'project/.applepi/profiles/state-replacement/profile.yml')).toContain(
      'state_persistence',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-002.2, APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses project-local sandbox defaults and keeps sandbox state writes temporary', async () => {
    const fixture = copyFixtureToTemp('local_sandbox_overrides');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;

    const result = await runFixture(fixture, {
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'local-sandbox',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              LOCAL_SANDBOX: plan.env.LOCAL_SANDBOX,
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              REPO_REVIEW: plan.env.REPO_REVIEW,
              REPO_STACK: plan.env.REPO_STACK,
              SHARED_LAYER: plan.env.SHARED_LAYER,
            },
            generatedProfile: JSON.parse(
              readFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), 'utf8'),
            ) as unknown,
            stateTargets: {
              'auth.json': tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'auth.json')),
                compositeProfileRoot,
              ),
              'mcp.json': tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'mcp.json')),
                compositeProfileRoot,
              ),
              utilities: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'utilities')),
                compositeProfileRoot,
              ),
            },
            sandboxState: {
              cacheExists: existsSync(join(compositeProfileRoot, 'cache')),
              sessionsExists: existsSync(join(compositeProfileRoot, 'sessions')),
              settingsExists: existsSync(join(compositeProfileRoot, 'settings.json')),
            },
          };

          writeFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"theme":"sandbox"}\n');
          mkdirSync(join(compositeProfileRoot, 'cache'), { recursive: true });
          writeFileSync(join(compositeProfileRoot, 'cache', 'experiment.json'), '{"cached":true}\n');
          mkdirSync(join(compositeProfileRoot, 'sessions'), { recursive: true });
          writeFileSync(join(compositeProfileRoot, 'sessions', 'scratch.log'), 'sandbox session\n');
          writeFileSync(join(compositeProfileRoot, 'scratch.txt'), 'unknown sandbox write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(result.profileId).toBe('local-sandbox');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe('{ "theme": "stable" }\n');
    expect(existsSync(join(fixture.project, '.applepi', 'local', 'cache', 'cache', 'experiment.json'))).toBe(false);
    expect(readFixtureText(fixture, 'project/.applepi/profiles/repo-review/profile.yml')).toContain('--repo-review');
    expect(readFixtureText(fixture, 'project/.applepi/local/profiles/local-sandbox/profile.yml')).toContain(
      'settings.json: warn',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.3, APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates and owns pi native fallback state when profiles provide no cli-specific state', async () => {
    const fixture = copyFixtureToTemp('native_fallback_cli_state');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'fallback-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'fallback-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              FALLBACK_LAYER: plan.env.FALLBACK_LAYER,
              PROJECT_NATIVE_FALLBACK: plan.env.PROJECT_NATIVE_FALLBACK,
              USER_NATIVE_DEFAULT: plan.env.USER_NATIVE_DEFAULT,
            },
            generatedProfile: JSON.parse(
              readFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), 'utf8'),
            ) as unknown,
            stateTargets: Object.fromEntries(
              [
                'auth.json',
                'settings.json',
                'mcp.json',
                'plugins',
                'cache',
                'sessions',
                'npm',
                'git',
                'tmp',
                'utilities',
                'bin',
              ].map((relativePath) => [
                relativePath,
                tokenizeFixturePath(
                  fixture,
                  readlinkSync(join(compositeProfileRoot, relativePath)),
                  compositeProfileRoot,
                ),
              ]),
            ),
          };

          writeFileSync(join(compositeProfileRoot, 'auth.json'), '{"token":"native-auth"}\n');
          writeFileSync(join(compositeProfileRoot, 'settings.json'), '{"approval":"on-request"}\n');
          writeFileSync(join(compositeProfileRoot, 'mcp.json'), '{"servers":{}}\n');
          writeFileSync(join(compositeProfileRoot, 'plugins', 'review.json'), '{"enabled":true}\n');
          writeFileSync(join(compositeProfileRoot, 'cache', 'index.json'), '{"cached":true}\n');
          writeFileSync(join(compositeProfileRoot, 'sessions', 'session.json'), '{"id":"fixture-session"}\n');
          writeFileSync(join(compositeProfileRoot, 'npm', 'package.json'), '{"name":"fixture-package"}\n');
          writeFileSync(join(compositeProfileRoot, 'git', 'checkout.json'), '{"repo":"fixture-repo"}\n');
          mkdirSync(join(compositeProfileRoot, 'tmp', 'extensions'), { recursive: true });
          writeFileSync(
            join(compositeProfileRoot, 'tmp', 'extensions', 'checkout.json'),
            '{"repo":"fixture-extension"}\n',
          );
          writeFileSync(join(compositeProfileRoot, 'utilities', 'tool.txt'), 'utility cache\n');
          writeFileSync(join(compositeProfileRoot, 'bin', 'pi-helper'), 'helper cache\n');
          writeFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), '{"mutated":true}\n');
          mkdirSync(join(compositeProfileRoot, 'scratch'), { recursive: true });
          writeFileSync(join(compositeProfileRoot, 'scratch', 'native-note.txt'), 'undeclared write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(result.profileId).toBe('fallback-review');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(existsSync(join(fixture.project, '.applepi', 'profiles', 'fallback-review', 'cli_specific'))).toBe(false);
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'auth.json'), 'utf8')).toBe('{"token":"native-auth"}\n');
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe(
      '{"approval":"on-request"}\n',
    );
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'mcp.json'), 'utf8')).toBe('{"servers":{}}\n');
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'plugins', 'review.json'), 'utf8')).toBe(
      '{"enabled":true}\n',
    );
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'cache', 'index.json'), 'utf8')).toBe('{"cached":true}\n');
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'sessions', 'session.json'), 'utf8')).toBe(
      '{"id":"fixture-session"}\n',
    );
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'npm', 'package.json'), 'utf8')).toBe(
      '{"name":"fixture-package"}\n',
    );
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'git', 'checkout.json'), 'utf8')).toBe(
      '{"repo":"fixture-repo"}\n',
    );
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'tmp', 'extensions', 'checkout.json'), 'utf8')).toBe(
      '{"repo":"fixture-extension"}\n',
    );
    expect(readFileSync(join(fixture.home, '.applepi', 'cache', 'utilities', 'tool.txt'), 'utf8')).toBe(
      'utility cache\n',
    );
    expect(readFileSync(join(fixture.home, '.applepi', 'cache', 'utilities', 'pi-helper'), 'utf8')).toBe(
      'helper cache\n',
    );
    expect(readFixtureText(fixture, 'project/.applepi/profiles/fallback-review/profile.yml')).toContain(
      'fallback-review-model',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.3, APPLEPI-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses the configured cache directory for reusable pi tooling state across compositeProfiles', async () => {
    const fixture = copyFixtureToTemp('cache_backed_tooling_state');
    const warnings: string[] = [];
    let compositeProfileSummary: unknown;
    let secondRunObservedCachedUtility = false;

    const firstResult = await runFixture(fixture, {
      profileId: 'cache-tooling',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          compositeProfileSummary = {
            profileId: 'cache-tooling',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              CACHE_TOOLING_PROFILE: plan.env.CACHE_TOOLING_PROFILE,
              PERSONAL_CACHE_DEFAULT: plan.env.PERSONAL_CACHE_DEFAULT,
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, compositeProfileRoot),
              TOOLING_OWNER: plan.env.TOOLING_OWNER,
            },
            generatedProfile: JSON.parse(
              readFileSync(join(compositeProfileRoot, 'applepi', 'profile.json'), 'utf8'),
            ) as unknown,
            stateTargets: {
              bin: tokenizeFixturePath(fixture, readlinkSync(join(compositeProfileRoot, 'bin')), compositeProfileRoot),
              cache: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'cache')),
                compositeProfileRoot,
              ),
              git: tokenizeFixturePath(fixture, readlinkSync(join(compositeProfileRoot, 'git')), compositeProfileRoot),
              npm: tokenizeFixturePath(fixture, readlinkSync(join(compositeProfileRoot, 'npm')), compositeProfileRoot),
              utilities: tokenizeFixturePath(
                fixture,
                readlinkSync(join(compositeProfileRoot, 'utilities')),
                compositeProfileRoot,
              ),
            },
          };

          writeFileSync(join(compositeProfileRoot, 'utilities', 'from-utilities.txt'), 'installed through utilities\n');
          writeFileSync(join(compositeProfileRoot, 'bin', 'from-bin.txt'), 'installed through bin\n');

          return Promise.resolve(0);
        },
      },
    });

    const secondResult = await runFixture(fixture, {
      profileId: 'cache-tooling',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const compositeProfileRoot = compositeProfileRootFromLaunchPlan(plan);
          secondRunObservedCachedUtility =
            readFileSync(join(compositeProfileRoot, 'utilities', 'from-utilities.txt'), 'utf8') ===
              'installed through utilities\n' &&
            readFileSync(join(compositeProfileRoot, 'bin', 'from-bin.txt'), 'utf8') === 'installed through bin\n';

          return Promise.resolve(0);
        },
      },
    });

    expect(compositeProfileSummary).toEqual(readExpectedJson(fixture, 'pi/composite-profile-summary.json'));
    expect(firstResult.profileId).toBe('cache-tooling');
    expect(firstResult.agentId).toBe('pi');
    expect(firstResult.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(secondResult.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual([]);
    expect(secondRunObservedCachedUtility).toBe(true);
    expect(readFileSync(join(fixture.root, 'cache', 'utilities', 'from-utilities.txt'), 'utf8')).toBe(
      'installed through utilities\n',
    );
    expect(readFileSync(join(fixture.root, 'cache', 'utilities', 'from-bin.txt'), 'utf8')).toBe(
      'installed through bin\n',
    );
    expect(existsSync(join(fixture.home, '.pi', 'agent', 'utilities', 'from-utilities.txt'))).toBe(false);
    expect(existsSync(join(fixture.home, '.pi', 'agent', 'bin', 'from-bin.txt'))).toBe(false);
    expect(
      existsSync(
        join(
          fixture.project,
          '.applepi',
          'profiles',
          'cache-tooling',
          'cli_specific',
          'pi',
          'utilities',
          'from-utilities.txt',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(fixture.project, '.applepi', 'profiles', 'cache-tooling', 'cli_specific', 'pi', 'bin', 'from-bin.txt'),
      ),
    ).toBe(false);
    expect(readFixtureText(fixture, 'project/.applepi/profiles/cache-tooling/profile.yml')).toContain(
      'CACHE_TOOLING_PROFILE',
    );
  });
});
