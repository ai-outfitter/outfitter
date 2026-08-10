// Verifies Claude credentials, exact-workspace trust, and project session history survive the
// isolated CLAUDE_CONFIG_DIR without copying or replacing unrelated machine-local state.
/* eslint-disable max-lines -- one cohesive state-persistence contract across helpers and command wiring. */
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  persistClaudeCredentials,
  persistClaudeSessions,
  resolveClaudeProjectSlug,
  seedClaudeCredentials,
  seedClaudeSessions,
} from '../../src/agents/ClaudeStatePersistence.js';
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
    chmodSync(credentials, 0o644);
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.12).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('seeds hasCompletedOnboarding only when durable state contains it', () => {
    const base = root();
    const home = join(base, 'home');
    const withOnboarding = join(base, 'with-onboarding');
    const withoutOnboarding = join(base, 'without-onboarding');
    const project = join(base, 'project');

    write(join(home, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
    seedClaudeCredentials(withOnboarding, home, project);
    expect(readJson(join(withOnboarding, '.claude.json'))).toEqual({ hasCompletedOnboarding: true });

    write(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'account' } }));
    seedClaudeCredentials(withoutOnboarding, home, project);
    expect(readJson(join(withoutOnboarding, '.claude.json'))).toEqual({
      oauthAccount: { accountUuid: 'account' },
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.14, OFTR-006.5.15, OFTR-006.5.16).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('copies credentials back at 0600 and atomically merges account metadata without clobbering keys', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    const projectedCredentials = {
      claudeAiOauth: { accessToken: 'claude-token' },
      mcpOAuth: {
        'example|hash': {
          serverName: 'example',
          serverUrl: 'https://mcp.example.test',
          accessToken: 'mcp-token',
          discoveryState: {},
        },
      },
    };
    write(join(projection, '.credentials.json'), JSON.stringify(projectedCredentials));
    write(
      join(projection, '.claude.json'),
      JSON.stringify({
        oauthAccount: { accountUuid: 'new' },
        projects: {},
        mcpOAuth: { 'not-a-credential-location': { accessToken: 'do-not-merge' } },
      }),
    );
    write(
      join(home, '.claude.json'),
      JSON.stringify({ oauthAccount: { accountUuid: 'old' }, numStartups: 42, projects: { keep: { value: true } } }),
    );

    persistClaudeCredentials(projection, home);

    const durableCredentials = join(home, '.claude', '.credentials.json');
    expect(readJson(durableCredentials)).toEqual(projectedCredentials);
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
    const warning = persistClaudeCredentials(projection, home, seededHash);

    expect(readFileSync(durableCredentials, 'utf8')).toBe('{"token":"after"}');
    expect(warning).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves concurrently refreshed durable credentials when the projection also changed', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    const durableCredentials = join(home, '.claude', '.credentials.json');
    write(durableCredentials, '{"token":"before"}');

    const seededHash = seedClaudeCredentials(projection, home, join(base, 'project'));
    write(durableCredentials, '{"token":"refreshed-concurrently"}');
    write(join(projection, '.credentials.json'), '{"token":"changed-by-run"}');
    const warning = persistClaudeCredentials(projection, home, seededHash);

    expect(readFileSync(durableCredentials, 'utf8')).toBe('{"token":"refreshed-concurrently"}');
    expect(warning).toBe(
      'Warning: durable Claude credentials changed during the run; skipped the credential copy-back to preserve the concurrent refresh.',
    );
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

  it('does not rewrite durable state when projected account metadata is unchanged', () => {
    const base = root();
    const projection = join(base, 'projection');
    const home = join(base, 'home');
    const state = '{"oauthAccount":{"accountUuid":"same"}}';
    write(join(projection, '.claude.json'), state);
    write(join(home, '.claude.json'), state);

    persistClaudeCredentials(projection, home);

    expect(readFileSync(join(home, '.claude.json'), 'utf8')).toBe(state);
  });
});

describe('Claude session persistence', () => {
  it.each([
    ['/home/ncrmro/notes', '-home-ncrmro-notes'],
    ['/home/ncrmro/.keystone/repos', '-home-ncrmro--keystone-repos'],
    ['/home/ncrmro/code/1e1104k4-eonmun', '-home-ncrmro-code-1e1104k4-eonmun'],
    ['/a/.b', '-a--b'],
  ])('mirrors Claude project slug encoding for %s', (project, expected) => {
    expect(resolveClaudeProjectSlug(project)).toBe(expected);
  });

  // Claude preserves literal dashes while mapping both separators and dots to dashes. This is
  // intentionally non-injective: `/a/.b` and `/a/-b` both encode as `-a--b`.
  it('documents Claude project slug non-injectivity', () => {
    expect(resolveClaudeProjectSlug('/a/.b')).toBe(resolveClaudeProjectSlug('/a/-b'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.17).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('seeds only the current project slug and preserves session mode 0600', () => {
    const base = root();
    const home = join(base, 'home');
    const projection = join(base, 'projection');
    const project = join(base, 'project.with spaces');
    const otherProject = join(base, 'private-project');
    const slug = resolveClaudeProjectSlug(project);
    const currentSession = join(home, '.claude', 'projects', slug, 'current.jsonl');
    write(currentSession, '{"session":"current"}\n');
    chmodSync(currentSession, 0o644);
    write(join(home, '.claude', 'projects', slug, 'session-uuid', 'subagents', 'agent-1.jsonl'), 'subagent');
    write(join(home, '.claude', 'projects', slug, 'session-uuid', 'subagents', 'agent-1.meta.json'), 'meta');
    write(join(home, '.claude', 'projects', slug, 'session-uuid', 'tool-results', 'result.txt'), 'result');
    write(join(home, '.claude', 'projects', slug, 'memory', 'MEMORY.md'), '# Memory');
    write(
      join(home, '.claude', 'projects', resolveClaudeProjectSlug(otherProject), 'private.jsonl'),
      '{"session":"private"}\n',
    );

    seedClaudeSessions(projection, home, project);

    const projectedSession = join(projection, 'projects', slug, 'current.jsonl');
    expect(readFileSync(projectedSession, 'utf8')).toBe('{"session":"current"}\n');
    expect(statSync(projectedSession).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(projection, 'projects', slug, 'session-uuid', 'subagents', 'agent-1.jsonl'), 'utf8')).toBe(
      'subagent',
    );
    expect(readFileSync(join(projection, 'projects', slug, 'session-uuid', 'tool-results', 'result.txt'), 'utf8')).toBe(
      'result',
    );
    expect(readFileSync(join(projection, 'projects', slug, 'memory', 'MEMORY.md'), 'utf8')).toBe('# Memory');
    expect(existsSync(join(projection, 'projects', resolveClaudeProjectSlug(otherProject)))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges changed sessions from every projected slug without deleting durable files', () => {
    const base = root();
    const home = join(base, 'home');
    const projection = join(base, 'projection');
    const durableProjects = join(home, '.claude', 'projects');
    write(join(durableProjects, 'slug-a', 'keep.jsonl'), 'keep');
    write(join(durableProjects, 'slug-a', 'nested', 'changed.jsonl'), 'before');
    const seed = seedClaudeSessions(projection, home, 'slug-a');
    write(join(projection, 'projects', 'slug-a', 'nested', 'changed.jsonl'), 'after');
    write(join(projection, 'projects', 'slug-b', 'new.jsonl'), 'new');
    write(join(projection, 'projects', 'ignored-file'), 'not a slug directory');

    persistClaudeSessions(projection, home, seed.hashes);

    expect(readFileSync(join(durableProjects, 'slug-a', 'keep.jsonl'), 'utf8')).toBe('keep');
    expect(readFileSync(join(durableProjects, 'slug-a', 'nested', 'changed.jsonl'), 'utf8')).toBe('after');
    expect(readFileSync(join(durableProjects, 'slug-b', 'new.jsonl'), 'utf8')).toBe('new');
    expect(statSync(join(durableProjects, 'slug-a', 'nested', 'changed.jsonl')).mode & 0o777).toBe(0o600);
    expect(statSync(join(durableProjects, 'slug-b', 'new.jsonl')).mode & 0o777).toBe(0o600);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges per file and preserves durable-only and concurrent changes', () => {
    const base = root();
    const home = join(base, 'home');
    const projection = join(base, 'projection');
    const project = '/home/ncrmro/notes';
    const slug = '-home-ncrmro-notes';
    const durable = join(home, '.claude', 'projects', slug);
    write(join(durable, 'projection-only.jsonl'), 'before');
    write(join(durable, 'durable-only.jsonl'), 'before');
    write(join(durable, 'conflict.jsonl'), 'before');

    const seed = seedClaudeSessions(projection, home, project);
    write(join(projection, 'projects', slug, 'projection-only.jsonl'), 'from projection');
    write(join(durable, 'durable-only.jsonl'), 'from durable');
    write(join(durable, 'conflict.jsonl'), 'from durable');
    write(join(projection, 'projects', slug, 'conflict.jsonl'), 'from projection');

    const warning = persistClaudeSessions(projection, home, seed.hashes);

    expect(readFileSync(join(durable, 'projection-only.jsonl'), 'utf8')).toBe('from projection');
    expect(readFileSync(join(durable, 'durable-only.jsonl'), 'utf8')).toBe('from durable');
    expect(readFileSync(join(durable, 'conflict.jsonl'), 'utf8')).toBe('from durable');
    expect(warning).toContain(`${slug}/conflict.jsonl`);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('continues recursive seed and persistence after per-file failures', () => {
    const base = root();
    const home = join(base, 'home');
    const projection = join(base, 'projection');
    const slug = '-home-ncrmro-notes';
    const durable = join(home, '.claude', 'projects', slug);
    write(join(durable, 'blocked', 'failed.jsonl'), 'failed');
    write(join(durable, 'good.jsonl'), 'good');
    write(join(projection, 'projects', slug, 'blocked'), 'destination collision');

    const seed = seedClaudeSessions(projection, home, '/home/ncrmro/notes');
    expect(seed.warning).toContain(`${slug}/blocked/failed.jsonl`);
    expect(readFileSync(join(projection, 'projects', slug, 'good.jsonl'), 'utf8')).toBe('good');

    write(join(projection, 'projects', slug, 'persist-blocked', 'failed.jsonl'), 'failed');
    write(join(projection, 'projects', slug, 'persist-good.jsonl'), 'persisted');
    write(join(durable, 'persist-blocked'), 'durable collision');
    const warning = persistClaudeSessions(projection, home, seed.hashes);
    expect(warning).toContain(`${slug}/persist-blocked/failed.jsonl`);
    expect(readFileSync(join(durable, 'persist-good.jsonl'), 'utf8')).toBe('persisted');
  });

  it('does nothing when projected or durable session history is absent', () => {
    const base = root();
    const home = join(base, 'home');
    const projection = join(base, 'projection');
    seedClaudeSessions(projection, home, join(base, 'project'));
    persistClaudeSessions(projection, home);
    expect(existsSync(join(home, '.claude', 'projects'))).toBe(false);
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.17, OFTR-006.5.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes a session written by one run resumable by the next run', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = '/home/ncrmro/notes';
    const slug = '-home-ncrmro-notes';
    const transcript = '{"sessionId":"first-run"}\n';
    write(join(home, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        write(join(plan.env.CLAUDE_CONFIG_DIR ?? '', 'projects', slug, 'session.jsonl'), transcript);
        return Promise.resolve(0);
      },
    });

    expect(readFileSync(join(home, '.claude', 'projects', slug, 'session.jsonl'), 'utf8')).toBe(transcript);
    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        expect(readFileSync(join(plan.env.CLAUDE_CONFIG_DIR ?? '', 'projects', slug, 'session.jsonl'), 'utf8')).toBe(
          transcript,
        );
        return Promise.resolve(0);
      },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists session history when the Claude launcher throws', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    const slug = resolveClaudeProjectSlug(project);
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');

    await expect(
      executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'engineer',
        harness: 'claude',
        launcher: (plan) => {
          write(join(plan.env.CLAUDE_CONFIG_DIR ?? '', 'projects', slug, 'failed.jsonl'), 'saved');
          return Promise.reject(new Error('launch failed'));
        },
      }),
    ).rejects.toThrow('launch failed');
    expect(readFileSync(join(home, '.claude', 'projects', slug, 'failed.jsonl'), 'utf8')).toBe('saved');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns a warning when concurrent durable and projected credential refreshes conflict', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    const durableCredentials = join(home, '.claude', '.credentials.json');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    write(durableCredentials, '{"token":"before"}');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        write(durableCredentials, '{"token":"refreshed-concurrently"}');
        writeFileSync(join(plan.env.CLAUDE_CONFIG_DIR ?? '', '.credentials.json'), '{"token":"changed-by-run"}');
        return Promise.resolve(0);
      },
    });

    expect(readFileSync(durableCredentials, 'utf8')).toBe('{"token":"refreshed-concurrently"}');
    expect(result.messages).toContain(
      'Warning: durable Claude credentials changed during the run; skipped the credential copy-back to preserve the concurrent refresh.',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns for session bridge failures without replacing the launcher exit code', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    const slug = resolveClaudeProjectSlug(project);
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    write(join(home, '.claude', 'projects', slug), 'not a directory');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        write(join(plan.env.CLAUDE_CONFIG_DIR ?? '', 'projects'), 'not a directory');
        return Promise.resolve(29);
      },
    });

    expect(result.exitCode).toBe(29);
    expect(result.messages).toEqual([
      expect.stringContaining('Claude session persistence failed for files'),
      expect.stringContaining('Claude session persistence failed for files'),
    ]);
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns the launcher exit code and late warning when the warning sink throws', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    write(join(home, '.claude'), 'not a directory');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        writeFileSync(join(plan.env.CLAUDE_CONFIG_DIR ?? '', '.credentials.json'), '{"changed":true}');
        return Promise.resolve(31);
      },
      writeLine: () => {
        throw new Error('broken warning sink');
      },
    });

    expect(result.exitCode).toBe(31);
    expect(result.messages).toEqual([expect.stringContaining('failed to persist Claude credentials')]);
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
