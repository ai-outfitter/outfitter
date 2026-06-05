// Tests fixture-backed integration behavior for tack generation and state ownership.
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from 'node:fs';
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-003.1, BRIDL-REQ-003.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses cached remote baseline settings while project-local settings select a local profile offline', async () => {
    const fixture = copyFixtureToTemp('remote_baseline_local_selection');
    const warnings: string[] = [];
    let tackSummary: unknown;

    const result = await runFixture(fixture, {
      warnings,
      launcher: {
        launch(plan) {
          const tackRoot = tackRootFromLaunchPlan(plan);
          tackSummary = {
            profileId: 'local-selection',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, tackRoot),
              LOCAL_SELECTION: plan.env.LOCAL_SELECTION,
              PROJECT_PROFILE: plan.env.PROJECT_PROFILE,
              REMOTE_BASELINE: plan.env.REMOTE_BASELINE,
              SHARED_BASELINE: plan.env.SHARED_BASELINE,
              SHARED_SELECTION: plan.env.SHARED_SELECTION,
              USER_DEFAULT: plan.env.USER_DEFAULT,
            },
            ...(summarizePiTack(fixture, tackRoot) as Record<string, unknown>),
          };

          writeFileSync(join(tackRoot, 'bridl', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(tackRoot, 'settings.json'), '{"owner":"pi-write","source":"LOCAL_SELECTION"}\n');
          writeFileSync(join(tackRoot, 'unexpected.txt'), 'unknown write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(tackSummary).toEqual(readExpectedJson(fixture, 'pi/tack-summary.json'));
    expect(result.profileId).toBe('local-selection');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(
      readFileSync(
        join(fixture.project, '.bridl', 'local', 'profiles', 'local-selection', 'cli_specific', 'pi', 'settings.json'),
        'utf8',
      ),
    ).toBe('{"owner":"pi-write","source":"LOCAL_SELECTION"}\n');
    expect(readFixtureText(fixture, 'home/.bridl/settings.yml')).toContain('remote_settings');
    expect(readFixtureText(fixture, 'project/.bridl/settings.yml')).not.toContain('default_profile');
    expect(readFixtureText(fixture, 'project/.bridl/local/settings.yml')).toContain('default_profile: local-selection');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('diagnoses declared persistent state symlinks replaced by the agent without changing sources', async () => {
    const fixture = copyFixtureToTemp('state_path_replaced_by_agent');
    const warnings: string[] = [];
    const sourceSettingsPath = join(
      fixture.project,
      '.bridl',
      'profiles',
      'state-replacement',
      'cli_specific',
      'pi',
      'settings.json',
    );
    const sourceSessionsPath = join(
      fixture.project,
      '.bridl',
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
          const tackRoot = tackRootFromLaunchPlan(plan);
          const settingsPath = join(tackRoot, 'settings.json');
          const sessionsPath = join(tackRoot, 'sessions');

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
    expect(readFixtureText(fixture, 'project/.bridl/profiles/state-replacement/profile.yml')).toContain(
      'state_persistence',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.2, BRIDL-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses project-local sandbox defaults and keeps sandbox state writes temporary', async () => {
    const fixture = copyFixtureToTemp('local_sandbox_overrides');
    const warnings: string[] = [];
    let tackSummary: unknown;

    const result = await runFixture(fixture, {
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const tackRoot = tackRootFromLaunchPlan(plan);
          tackSummary = {
            profileId: 'local-sandbox',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              LOCAL_SANDBOX: plan.env.LOCAL_SANDBOX,
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, tackRoot),
              REPO_REVIEW: plan.env.REPO_REVIEW,
              REPO_STACK: plan.env.REPO_STACK,
              SHARED_LAYER: plan.env.SHARED_LAYER,
            },
            generatedProfile: JSON.parse(readFileSync(join(tackRoot, 'bridl', 'profile.json'), 'utf8')) as unknown,
            stateTargets: {
              'auth.json': tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'auth.json')), tackRoot),
              'mcp.json': tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'mcp.json')), tackRoot),
              utilities: tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'utilities')), tackRoot),
            },
            sandboxState: {
              cacheExists: existsSync(join(tackRoot, 'cache')),
              sessionsExists: existsSync(join(tackRoot, 'sessions')),
              settingsExists: existsSync(join(tackRoot, 'settings.json')),
            },
          };

          writeFileSync(join(tackRoot, 'bridl', 'profile.json'), '{"mutated":true}\n');
          writeFileSync(join(tackRoot, 'settings.json'), '{"theme":"sandbox"}\n');
          mkdirSync(join(tackRoot, 'cache'), { recursive: true });
          writeFileSync(join(tackRoot, 'cache', 'experiment.json'), '{"cached":true}\n');
          mkdirSync(join(tackRoot, 'sessions'), { recursive: true });
          writeFileSync(join(tackRoot, 'sessions', 'scratch.log'), 'sandbox session\n');
          writeFileSync(join(tackRoot, 'scratch.txt'), 'unknown sandbox write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(tackSummary).toEqual(readExpectedJson(fixture, 'pi/tack-summary.json'));
    expect(result.profileId).toBe('local-sandbox');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(readFileSync(join(fixture.home, '.pi', 'agent', 'settings.json'), 'utf8')).toBe('{ "theme": "stable" }\n');
    expect(existsSync(join(fixture.project, '.bridl', 'local', 'cache', 'cache', 'experiment.json'))).toBe(false);
    expect(readFixtureText(fixture, 'project/.bridl/profiles/repo-review/profile.yml')).toContain('--repo-review');
    expect(readFixtureText(fixture, 'project/.bridl/local/profiles/local-sandbox/profile.yml')).toContain(
      'settings.json: warn',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.3, BRIDL-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates and owns pi native fallback state when profiles provide no cli-specific state', async () => {
    const fixture = copyFixtureToTemp('native_fallback_cli_state');
    const warnings: string[] = [];
    let tackSummary: unknown;

    const result = await runFixture(fixture, {
      profileId: 'fallback-review',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const tackRoot = tackRootFromLaunchPlan(plan);
          tackSummary = {
            profileId: 'fallback-review',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, tackRoot),
              FALLBACK_LAYER: plan.env.FALLBACK_LAYER,
              PROJECT_NATIVE_FALLBACK: plan.env.PROJECT_NATIVE_FALLBACK,
              USER_NATIVE_DEFAULT: plan.env.USER_NATIVE_DEFAULT,
            },
            generatedProfile: JSON.parse(readFileSync(join(tackRoot, 'bridl', 'profile.json'), 'utf8')) as unknown,
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
                'utilities',
                'bin',
              ].map((relativePath) => [
                relativePath,
                tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, relativePath)), tackRoot),
              ]),
            ),
          };

          writeFileSync(join(tackRoot, 'auth.json'), '{"token":"native-auth"}\n');
          writeFileSync(join(tackRoot, 'settings.json'), '{"approval":"on-request"}\n');
          writeFileSync(join(tackRoot, 'mcp.json'), '{"servers":{}}\n');
          writeFileSync(join(tackRoot, 'plugins', 'review.json'), '{"enabled":true}\n');
          writeFileSync(join(tackRoot, 'cache', 'index.json'), '{"cached":true}\n');
          writeFileSync(join(tackRoot, 'sessions', 'session.json'), '{"id":"fixture-session"}\n');
          writeFileSync(join(tackRoot, 'npm', 'package.json'), '{"name":"fixture-package"}\n');
          writeFileSync(join(tackRoot, 'git', 'checkout.json'), '{"repo":"fixture-repo"}\n');
          writeFileSync(join(tackRoot, 'utilities', 'tool.txt'), 'utility cache\n');
          writeFileSync(join(tackRoot, 'bin', 'pi-helper'), 'helper cache\n');
          writeFileSync(join(tackRoot, 'bridl', 'profile.json'), '{"mutated":true}\n');
          mkdirSync(join(tackRoot, 'scratch'), { recursive: true });
          writeFileSync(join(tackRoot, 'scratch', 'native-note.txt'), 'undeclared write\n');

          return Promise.resolve(0);
        },
      },
    });

    expect(tackSummary).toEqual(readExpectedJson(fixture, 'pi/tack-summary.json'));
    expect(result.profileId).toBe('fallback-review');
    expect(result.agentId).toBe('pi');
    expect(result.warnings).toEqual(readExpectedJson(fixture, 'pi/warnings.json'));
    expect(warnings).toEqual(result.warnings);
    expect(existsSync(join(fixture.project, '.bridl', 'profiles', 'fallback-review', 'cli_specific'))).toBe(false);
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
    expect(readFileSync(join(fixture.home, '.bridl', 'cache', 'utilities', 'tool.txt'), 'utf8')).toBe(
      'utility cache\n',
    );
    expect(readFileSync(join(fixture.home, '.bridl', 'cache', 'utilities', 'pi-helper'), 'utf8')).toBe(
      'helper cache\n',
    );
    expect(readFixtureText(fixture, 'project/.bridl/profiles/fallback-review/profile.yml')).toContain(
      'fallback-review-model',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.3, BRIDL-REQ-005.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses the configured cache directory for reusable pi tooling state across tacks', async () => {
    const fixture = copyFixtureToTemp('cache_backed_tooling_state');
    const warnings: string[] = [];
    let tackSummary: unknown;
    let secondRunObservedCachedUtility = false;

    const firstResult = await runFixture(fixture, {
      profileId: 'cache-tooling',
      agentId: 'pi',
      warnings,
      launcher: {
        launch(plan) {
          const tackRoot = tackRootFromLaunchPlan(plan);
          tackSummary = {
            profileId: 'cache-tooling',
            agentId: 'pi',
            launchCommand: plan.command,
            launchArgs: plan.args,
            launchEnv: {
              CACHE_TOOLING_PROFILE: plan.env.CACHE_TOOLING_PROFILE,
              PERSONAL_CACHE_DEFAULT: plan.env.PERSONAL_CACHE_DEFAULT,
              PI_CODING_AGENT_DIR: tokenizeFixturePath(fixture, plan.env.PI_CODING_AGENT_DIR, tackRoot),
              TOOLING_OWNER: plan.env.TOOLING_OWNER,
            },
            generatedProfile: JSON.parse(readFileSync(join(tackRoot, 'bridl', 'profile.json'), 'utf8')) as unknown,
            stateTargets: {
              bin: tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'bin')), tackRoot),
              cache: tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'cache')), tackRoot),
              git: tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'git')), tackRoot),
              npm: tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'npm')), tackRoot),
              utilities: tokenizeFixturePath(fixture, readlinkSync(join(tackRoot, 'utilities')), tackRoot),
            },
          };

          writeFileSync(join(tackRoot, 'utilities', 'from-utilities.txt'), 'installed through utilities\n');
          writeFileSync(join(tackRoot, 'bin', 'from-bin.txt'), 'installed through bin\n');

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
          const tackRoot = tackRootFromLaunchPlan(plan);
          secondRunObservedCachedUtility =
            readFileSync(join(tackRoot, 'utilities', 'from-utilities.txt'), 'utf8') ===
              'installed through utilities\n' &&
            readFileSync(join(tackRoot, 'bin', 'from-bin.txt'), 'utf8') === 'installed through bin\n';

          return Promise.resolve(0);
        },
      },
    });

    expect(tackSummary).toEqual(readExpectedJson(fixture, 'pi/tack-summary.json'));
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
          '.bridl',
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
        join(fixture.project, '.bridl', 'profiles', 'cache-tooling', 'cli_specific', 'pi', 'bin', 'from-bin.txt'),
      ),
    ).toBe(false);
    expect(readFixtureText(fixture, 'project/.bridl/profiles/cache-tooling/profile.yml')).toContain(
      'CACHE_TOOLING_PROFILE',
    );
  });
});
