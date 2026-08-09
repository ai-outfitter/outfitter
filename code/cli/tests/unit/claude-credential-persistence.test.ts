// Verifies Claude credentials and exact-workspace trust survive the isolated CLAUDE_CONFIG_DIR
// without copying or replacing unrelated machine-local ~/.claude.json state.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { persistClaudeCredentials, seedClaudeCredentials } from '../../src/agents/ClaudeCredentialPersistence.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-claude-cred-'));
  roots.push(directory);
  return directory;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('Claude credential persistence', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.12, OFTR-006.5.13).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('seeds credentials, account metadata, and trust for only the exact working directory', () => {
    const base = root();
    const home = join(base, 'home');
    const projection = join(base, 'projection');
    const project = join(base, 'project');
    const otherProject = join(base, 'other');
    const credentials = join(home, '.claude', '.credentials.json');
    write(credentials, '{"claudeAiOauth":{"accessToken":"secret"}}');
    chmodSync(credentials, 0o600);
    write(
      join(home, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'account' },
        numStartups: 42,
        projects: {
          [project]: { hasTrustDialogAccepted: true, history: ['private'] },
          [otherProject]: { hasTrustDialogAccepted: true },
        },
      }),
    );

    seedClaudeCredentials(projection, home, project);

    expect(readFileSync(join(projection, '.credentials.json'), 'utf8')).toContain('accessToken');
    expect(statSync(join(projection, '.credentials.json')).mode & 0o777).toBe(0o600);
    expect(readJson(join(projection, '.claude.json'))).toEqual({
      oauthAccount: { accountUuid: 'account' },
      projects: { [project]: { hasTrustDialogAccepted: true } },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.12, OFTR-006.5.13).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does nothing when durable state is absent and never invents workspace trust', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    const project = join(base, 'project');

    seedClaudeCredentials(projection, home, project);
    expect(existsSync(join(projection, '.credentials.json'))).toBe(false);
    expect(existsSync(join(projection, '.claude.json'))).toBe(false);

    write(join(home, '.claude.json'), JSON.stringify({ projects: { [project]: { hasTrustDialogAccepted: false } } }));
    seedClaudeCredentials(projection, home, project);
    expect(existsSync(join(projection, '.claude.json'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.12).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('ignores malformed, non-object, and structurally unrelated durable state', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    const durableState = join(home, '.claude.json');

    write(durableState, '{');
    seedClaudeCredentials(projection, home, join(base, 'project'));
    write(durableState, '[]');
    seedClaudeCredentials(projection, home, join(base, 'project'));
    write(durableState, JSON.stringify({ projects: [] }));
    seedClaudeCredentials(projection, home, join(base, 'project'));

    expect(existsSync(join(projection, '.claude.json'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.14, OFTR-006.5.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('copies credentials back at 0600 and atomically merges account metadata without clobbering keys', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    write(join(projection, '.credentials.json'), '{"new":"credential"}');
    write(join(projection, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'new' }, projects: {} }));
    write(
      join(home, '.claude.json'),
      JSON.stringify({ oauthAccount: { accountUuid: 'old' }, numStartups: 42, projects: { keep: { value: true } } }),
    );

    persistClaudeCredentials(projection, home);

    const durableCredentials = join(home, '.claude', '.credentials.json');
    expect(readFileSync(durableCredentials, 'utf8')).toBe('{"new":"credential"}');
    expect(statSync(durableCredentials).mode & 0o777).toBe(0o600);
    expect(readJson(join(home, '.claude.json'))).toEqual({
      oauthAccount: { accountUuid: 'new' },
      numStartups: 42,
      projects: { keep: { value: true } },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not copy back an unchanged seeded credentials file', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    const durableCredentials = join(home, '.claude', '.credentials.json');
    write(durableCredentials, '{"token":"launch-time"}');

    const seededHash = seedClaudeCredentials(projection, home, join(base, 'project'));
    write(durableCredentials, '{"token":"refreshed-concurrently"}');
    persistClaudeCredentials(projection, home, seededHash);

    expect(readFileSync(durableCredentials, 'utf8')).toBe('{"token":"refreshed-concurrently"}');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('copies back a credentials file changed after seeding', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    const durableCredentials = join(home, '.claude', '.credentials.json');
    write(durableCredentials, '{"token":"before"}');

    const seededHash = seedClaudeCredentials(projection, home, join(base, 'project'));
    write(join(projection, '.credentials.json'), '{"token":"after"}');
    persistClaudeCredentials(projection, home, seededHash);

    expect(readFileSync(durableCredentials, 'utf8')).toBe('{"token":"after"}');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates durable account metadata when absent but preserves an invalid durable file', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    write(join(projection, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'new' } }));

    persistClaudeCredentials(projection, home);
    expect(readJson(join(home, '.claude.json'))).toEqual({ oauthAccount: { accountUuid: 'new' } });

    write(join(home, '.claude.json'), '{invalid');
    persistClaudeCredentials(projection, home);
    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe('{invalid');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not rewrite durable state when projected account metadata is absent or invalid', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    write(join(home, '.claude.json'), '{"keep":true}');

    persistClaudeCredentials(projection, home);
    write(join(projection, '.claude.json'), '[]');
    persistClaudeCredentials(projection, home);
    write(join(projection, '.claude.json'), '{}');
    persistClaudeCredentials(projection, home);

    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe('{"keep":true}');
  });
});

describe('run agent Claude credential write-back', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.12, OFTR-006.5.13, OFTR-006.5.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('seeds before launch and persists credentials after a successful Claude run', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    write(join(home, '.claude', '.credentials.json'), '{"before":true}');
    write(
      join(home, '.claude.json'),
      JSON.stringify({
        projects: { [project]: { hasTrustDialogAccepted: true }, [home]: { hasTrustDialogAccepted: false } },
      }),
    );

    const launcher = (plan: AgentLaunchPlan): Promise<number> => {
      const configDirectory = plan.env.CLAUDE_CONFIG_DIR ?? '';
      expect(readFileSync(join(configDirectory, '.credentials.json'), 'utf8')).toBe('{"before":true}');
      expect(readJson(join(configDirectory, '.claude.json'))).toEqual({
        projects: { [project]: { hasTrustDialogAccepted: true } },
      });
      writeFileSync(join(configDirectory, '.credentials.json'), '{"after":true}');
      return Promise.resolve(0);
    };

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher,
    });

    expect(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8')).toBe('{"after":true}');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.14, OFTR-006.5.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists credentials when the Claude launcher fails', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');

    const launcher = (plan: AgentLaunchPlan): Promise<number> => {
      writeFileSync(join(plan.env.CLAUDE_CONFIG_DIR ?? '', '.credentials.json'), '{"afterFailure":true}');
      writeFileSync(
        join(plan.env.CLAUDE_CONFIG_DIR ?? '', '.claude.json'),
        JSON.stringify({ oauthAccount: { accountUuid: 'after-failure' } }),
      );
      return Promise.reject(new Error('launch failed'));
    };

    await expect(
      executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'engineer',
        harness: 'claude',
        launcher,
      }),
    ).rejects.toThrow('launch failed');
    expect(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8')).toBe('{"afterFailure":true}');
    expect(readJson(join(home, '.claude.json'))).toEqual({ oauthAccount: { accountUuid: 'after-failure' } });
  });

  it('preserves a launcher exit code when Claude credential persistence fails', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    const warnings: string[] = [];
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    write(join(home, '.claude'), 'not a directory');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        writeFileSync(join(plan.env.CLAUDE_CONFIG_DIR ?? '', '.credentials.json'), '{"changed":true}');
        return Promise.resolve(23);
      },
      writeLine: (line) => warnings.push(line),
    });

    expect(result.exitCode).toBe(23);
    expect(warnings).toEqual([expect.stringContaining('failed to persist Claude credentials')]);
  });

  it('preserves a launcher error when Claude credential persistence fails', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    const warnings: string[] = [];
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    write(join(home, '.claude'), 'not a directory');

    await expect(
      executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'engineer',
        harness: 'claude',
        launcher: (plan) => {
          writeFileSync(join(plan.env.CLAUDE_CONFIG_DIR ?? '', '.credentials.json'), '{"changed":true}');
          return Promise.reject(new Error('original launcher diagnostic'));
        },
        writeLine: (line) => warnings.push(line),
      }),
    ).rejects.toThrow('original launcher diagnostic');
    expect(warnings).toEqual([expect.stringContaining('failed to persist Claude credentials')]);
  });
});
