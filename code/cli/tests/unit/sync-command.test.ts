// Tests .agents-native remote synchronization, sequencing, safety, status, and enterprise gating.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createSyncCommand, executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { createEnterprisePrivateCatalogGate } from '../../src/sources/PrivateCatalogGate.js';
import { createRemoteRepositoryCachePath } from '../../src/sources/SourceCache.js';

const temporaryRoots: string[] = [];

const git = (arguments_: readonly string[]): string =>
  execFileSync('git', [...arguments_], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agent = (name: string, body = ''): string =>
  `---\nname: ${name}\ndescription: ${name} test agent.\n---\n\n# ${name}\n\n${body}\n`;

const createRepository = (
  files: Readonly<Record<string, string>>,
): { readonly root: string; readonly commit: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-sync-source-'));
  temporaryRoots.push(root);
  git(['init', '--quiet', root]);
  git(['-C', root, 'config', 'user.name', 'Outfitter Tests']);
  git(['-C', root, 'config', 'user.email', 'tests@outfitter.dev']);
  for (const [path, content] of Object.entries(files)) write(join(root, path), content);
  git(['-C', root, 'add', '.']);
  git(['-C', root, 'commit', '--quiet', '-m', 'initial']);
  return { root, commit: git(['-C', root, 'rev-parse', 'HEAD']) };
};

const commitFile = (repository: string, path: string, content: string, message: string): string => {
  write(join(repository, path), content);
  git(['-C', repository, 'add', path]);
  git(['-C', repository, 'commit', '--quiet', '-m', message]);
  return git(['-C', repository, 'rev-parse', 'HEAD']);
};

const createInvocation = (): {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly root: string;
} => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-sync-invocation-'));
  temporaryRoots.push(root);
  return {
    root,
    homeDirectory: join(root, 'home'),
    projectDirectory: join(root, 'project'),
  };
};

const writeHomeSettings = (homeDirectory: string, content: string): void =>
  write(join(homeDirectory, '.agents', 'settings.yml'), content);

afterEach(() => {
  process.exitCode = undefined;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('sync command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.1, OFTR-004.2.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('registers the command object and reports an empty configuration successfully', async () => {
    const input = createInvocation();
    writeHomeSettings(input.homeDirectory, 'sources:\n  - path: ./local-catalog\n');
    const lines: string[] = [];
    const program = new Command();
    createSyncCommand({
      ...input,
      writeLine: (line) => lines.push(line),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'sync']);

    expect(lines).toEqual(['No remote sources are configured.']);
    expect(process.exitCode).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails before synchronization when local settings are invalid', () => {
    const input = createInvocation();
    writeHomeSettings(input.homeDirectory, 'default_harness: invalid\n');

    const result = executeSyncCommand(input);

    expect(result.exitCode).toBe(1);
    expect(result.results).toEqual([]);
    expect(result.messages.join('\n')).toContain('Local settings are invalid');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('sets the command exit status and prints diagnostics for required failures', async () => {
    const input = createInvocation();
    const lines: string[] = [];
    writeHomeSettings(input.homeDirectory, 'default_harness: invalid\n');
    const program = new Command();
    createSyncCommand({
      ...input,
      writeLine: (line) => lines.push(line),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'sync']);

    expect(process.exitCode).toBe(1);
    expect(lines.join('\n')).toContain('Local settings are invalid');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.6, OFTR-004.2.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails missing or invalid remote settings before making either checkout active', () => {
    const input = createInvocation();
    const missing = createRepository({ 'README.md': '# no settings\n' });
    const invalid = createRepository({ 'settings.yml': 'default_harness: invalid\n' });
    writeHomeSettings(
      input.homeDirectory,
      `remote_settings:\n  - uri: ${JSON.stringify(
        missing.root,
      )}\n    path: settings.yml\n  - uri: ${JSON.stringify(invalid.root)}\n    path: settings.yml\n`,
    );

    const result = executeSyncCommand(input);

    expect(result.exitCode).toBe(1);
    expect(result.results.map((entry) => entry.status)).toEqual(['failed', 'failed']);
    expect(result.messages.join('\n')).toContain('Remote settings file');
    expect(result.messages.join('\n')).toContain('Fetched remote settings are invalid');
    expect(result.messages.join('\n')).toContain('Merged settings contain errors');
    expect(result.results.every((entry) => !existsSync(entry.cachePath))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.2, OFTR-004.2.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('syncs remote settings first, reloads them, then discovers sources in a configured cache', () => {
    const input = createInvocation();
    const cacheDirectory = join(input.root, 'configured-cache');
    const catalog = createRepository({
      'agents/remote/agent.md': agent('remote'),
    });
    const control = createRepository({
      'settings.yml': `sources:\n  - uri: ${JSON.stringify(catalog.root)}\n`,
    });
    writeHomeSettings(
      input.homeDirectory,
      `cache_directory: ${cacheDirectory}\nremote_settings:\n  - uri: ${JSON.stringify(
        control.root,
      )}\n    path: settings.yml\n`,
    );

    const result = executeSyncCommand(input);

    expect(result.exitCode).toBe(0);
    expect(result.results.map(({ kind, status }) => ({ kind, status }))).toEqual([
      { kind: 'remote_settings', status: 'updated' },
      { kind: 'source', status: 'updated' },
    ]);
    expect(result.results.every((entry) => entry.cachePath.startsWith(cacheDirectory))).toBe(true);
    expect(
      existsSync(
        join(
          createRemoteRepositoryCachePath(input.homeDirectory, { uri: catalog.root }, cacheDirectory),
          'agents',
          'remote',
          'agent.md',
        ),
      ),
    ).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.3, OFTR-004.2.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('checks out pinned refs, updates unpinned refs, and reports unchanged repeat syncs', () => {
    const input = createInvocation();
    const catalog = createRepository({
      'agents/old/agent.md': agent('old'),
    });
    git(['-C', catalog.root, 'tag', 'v1.0.0']);
    const latestCommit = commitFile(catalog.root, 'agents/latest/agent.md', agent('latest'), 'add latest agent');
    writeHomeSettings(
      input.homeDirectory,
      `sources:\n  - uri: ${JSON.stringify(catalog.root)}\n    ref: v1.0.0\n  - uri: ${JSON.stringify(catalog.root)}\n`,
    );

    const first = executeSyncCommand(input);
    const pinnedPath = createRemoteRepositoryCachePath(input.homeDirectory, {
      uri: catalog.root,
      ref: 'v1.0.0',
    });
    const movingPath = createRemoteRepositoryCachePath(input.homeDirectory, { uri: catalog.root });

    expect(first.results.map((result) => result.status)).toEqual(['updated', 'updated']);
    expect(git(['-C', pinnedPath, 'rev-parse', 'HEAD'])).toBe(catalog.commit);
    expect(git(['-C', movingPath, 'rev-parse', 'HEAD'])).toBe(latestCommit);

    const second = executeSyncCommand(input);
    expect(second.results.map((result) => result.status)).toEqual(['unchanged', 'unchanged']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.6, OFTR-004.2.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates repository subpaths and reports non-fatal payload warnings', () => {
    const input = createInvocation();
    const catalog = createRepository({
      'payload/agents/warned/agent.md': agent('warned'),
      'payload/agents/warned/mcp.json': '{}\n',
    });
    writeHomeSettings(
      input.homeDirectory,
      `sources:\n  - uri: ${JSON.stringify(catalog.root)}\n    path: missing\n  - uri: ${JSON.stringify(
        catalog.root,
      )}\n    path: payload\n`,
    );

    const result = executeSyncCommand(input);

    expect(result.exitCode).toBe(1);
    expect(result.results.map((entry) => entry.status)).toEqual(['failed', 'updated']);
    expect(result.results[0]?.message).toContain('was not found');
    expect(result.results[1]?.message).toContain('validated with 1 warning');
  });

  it('replaces a malformed non-Git cache with a valid fetched checkout', () => {
    const input = createInvocation();
    const catalog = createRepository({
      'agents/fresh/agent.md': agent('fresh'),
    });
    const source = { uri: catalog.root } as const;
    const cachePath = createRemoteRepositoryCachePath(input.homeDirectory, source);
    mkdirSync(join(cachePath, '.git'), { recursive: true });
    writeHomeSettings(input.homeDirectory, `sources:\n  - uri: ${JSON.stringify(catalog.root)}\n`);

    const result = executeSyncCommand(input);

    expect(result.results[0]?.status).toBe('updated');
    expect(git(['-C', cachePath, 'rev-parse', 'HEAD'])).toBe(catalog.commit);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.7, OFTR-004.2.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves the last valid cache when a fetched update fails validation', () => {
    const input = createInvocation();
    const catalog = createRepository({
      'agents/stable/agent.md': agent('stable', 'last good'),
    });
    writeHomeSettings(input.homeDirectory, `sources:\n  - uri: ${JSON.stringify(catalog.root)}\n`);
    const first = executeSyncCommand(input);
    const cachePath = first.results[0].cachePath;
    const cachedCommit = git(['-C', cachePath, 'rev-parse', 'HEAD']);

    commitFile(catalog.root, 'agents/stable/agent.md', agent('wrong-name', 'invalid update'), 'invalid agent identity');
    const second = executeSyncCommand(input);

    expect(second.exitCode).toBe(1);
    expect(second.results[0]?.status).toBe('failed');
    expect(git(['-C', cachePath, 'rev-parse', 'HEAD'])).toBe(cachedCommit);
    expect(readFileSync(join(cachePath, 'agents', 'stable', 'agent.md'), 'utf8')).toContain('last good');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.7, OFTR-004.2.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves the last valid cache when the remote can no longer be fetched', () => {
    const input = createInvocation();
    const catalog = createRepository({
      'agents/stable/agent.md': agent('stable', 'available'),
    });
    writeHomeSettings(input.homeDirectory, `sources:\n  - uri: ${JSON.stringify(catalog.root)}\n`);
    const first = executeSyncCommand(input);
    const cachePath = first.results[0].cachePath;
    const unavailablePath = `${catalog.root}-offline`;
    renameSync(catalog.root, unavailablePath);
    temporaryRoots[temporaryRoots.indexOf(catalog.root)] = unavailablePath;

    const second = executeSyncCommand(input);

    expect(second.exitCode).toBe(1);
    expect(second.results[0]?.status).toBe('failed');
    expect(readFileSync(join(cachePath, 'agents', 'stable', 'agent.md'), 'utf8')).toContain('available');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('redacts embedded credentials from result URIs, errors, and cache paths', () => {
    const input = createInvocation();
    const credentialedUri = 'https://user:super-secret@127.0.0.1:9/catalog.git';
    writeHomeSettings(input.homeDirectory, `sources:\n  - uri: ${JSON.stringify(credentialedUri)}\n`);

    const result = executeSyncCommand(input);
    const output = JSON.stringify(result);

    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.status).toBe('failed');
    expect(output).not.toContain('super-secret');
    expect(output).not.toContain('user:');
    expect(output).toContain('REDACTED');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.7, OFTR-004.2.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns a successful skipped result for a gated private source', () => {
    const input = createInvocation();
    writeHomeSettings(input.homeDirectory, 'sources:\n  - github: acme/private\n');

    const result = executeSyncCommand(input, {
      classifier: { classify: () => 'private' },
      prompt: { interactive: false, confirm: () => false },
    });

    expect(result.exitCode).toBe(0);
    expect(result.results).toMatchObject([{ kind: 'source', status: 'skipped' }]);
    expect(result.messages.join('\n')).toContain('~/.agents/settings.yml');
  });
});

describe('private catalog gate', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.10, OFTR-004.2.13).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('enables accepted private catalogs in ~/.agents/settings.yml', () => {
    const input = createInvocation();
    const gate = createEnterprisePrivateCatalogGate({
      homeDirectory: input.homeDirectory,
      classifier: { classify: () => 'private' },
      prompt: { interactive: true, confirm: () => true },
    });

    const result = gate.filter([{ github: 'acme/private' }]);
    const settingsPath = join(input.homeDirectory, '.agents', 'settings.yml');

    expect(result.allowedSources).toEqual([{ github: 'acme/private' }]);
    expect(result.messages).toContain('info: Enabled private profile catalogs in ~/.agents/settings.yml.');
    expect(readFileSync(settingsPath, 'utf8')).toContain('private_catalogs: true');
    expect(existsSync(join(input.homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.14, OFTR-004.2.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns skipped status and guidance for a declined or non-interactive private catalog', () => {
    const input = createInvocation();
    const gate = createEnterprisePrivateCatalogGate({
      homeDirectory: input.homeDirectory,
      classifier: { classify: () => 'private' },
      prompt: { interactive: false, confirm: () => false },
    });

    const result = gate.filter([{ github: 'acme/private' }], join(input.root, 'cache'));

    expect(result.allowedSources).toEqual([]);
    expect(result.skippedResults[0]?.status).toBe('skipped');
    expect(result.skippedResults[0]?.cachePath).toContain(join(input.root, 'cache', 'repos'));
    expect(result.messages.join('\n')).toContain('~/.agents/settings.yml');
  });
});
