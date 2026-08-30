import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGit } from '../../src/sources/GitRepository.js';
import { createRemoteRepositoryCachePath } from '../../src/sources/SourceCache.js';
import { prepareSourceCaches } from '../../src/sources/SourceCachePolicy.js';
import {
  inspectSourceCache,
  readSourceState,
  sourceStatePath,
  withSourceLock,
  writeSourceState,
} from '../../src/sources/SourceState.js';

const roots: string[] = [];
const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-source-policy-'));
  roots.push(root);
  return root;
};
const write = (path: string, value: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
};
const repository = (root: string): { readonly uri: string; readonly commit: string } => {
  const repo = join(root, 'origin');
  mkdirSync(repo);
  runGit(['init', '--quiet', repo]);
  write(join(repo, 'agents', 'assistant', 'agent.md'), '---\nname: assistant\n---\n\nReady.\n');
  runGit(['-C', repo, 'add', '.']);
  runGit([
    '-C',
    repo,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '--quiet',
    '-m',
    'fixture',
  ]);
  return { uri: `file://${repo}`, commit: runGit(['-C', repo, 'rev-parse', 'HEAD']) };
};
const configure = (root: string, uri: string, ref?: string): { readonly home: string; readonly project: string } => {
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(
    join(home, '.agents', 'settings.yml'),
    `sources:\n  - uri: ${uri}${ref === undefined ? '' : `\n    ref: ${ref}`}\n`,
  );
  mkdirSync(project, { recursive: true });
  return { home, project };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('source-cache startup policy', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.19–23).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('repairs cold and dirty caches, writes state, and reuses a warm cache offline', () => {
    const root = temporaryRoot();
    const origin = repository(root);
    const locations = configure(root, origin.uri, origin.commit);
    const source = { uri: origin.uri, ref: origin.commit } as const;

    prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' });
    const cachePath = createRemoteRepositoryCachePath(locations.home, source);
    expect(inspectSourceCache({ homeDirectory: locations.home, cachePath, source })).toMatchObject({
      health: 'healthy',
      commit: origin.commit,
    });
    expect(readSourceState(sourceStatePath(locations.home, source))?.resolvedCommit).toBe(origin.commit);

    renameSync(join(root, 'origin'), join(root, 'origin-offline'));
    expect(() =>
      prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' }),
    ).not.toThrow();
    renameSync(join(root, 'origin-offline'), join(root, 'origin'));

    write(join(cachePath, 'dirty'), 'dirty');
    prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' });
    expect(readdirSync(dirname(cachePath)).some((name) => name.includes('.outfitter-quarantine-'))).toBe(true);
    expect(existsSync(join(cachePath, 'dirty'))).toBe(false);
  });

  it('fails closed offline and locked, while accepting a healthy full pin', () => {
    const root = temporaryRoot();
    const origin = repository(root);
    const mutable = configure(root, origin.uri, 'main');
    expect(() =>
      prepareSourceCaches({ homeDirectory: mutable.home, projectDirectory: mutable.project, policy: 'offline' }),
    ).toThrow(/offline policy prohibits repair/);
    expect(() =>
      prepareSourceCaches({ homeDirectory: mutable.home, projectDirectory: mutable.project, policy: 'locked' }),
    ).toThrow(/40-character commit pin/);

    const pinned = configure(root, origin.uri, origin.commit);
    prepareSourceCaches({ homeDirectory: pinned.home, projectDirectory: pinned.project, policy: 'locked' });
    expect(() =>
      prepareSourceCaches({ homeDirectory: pinned.home, projectDirectory: pinned.project, policy: 'offline' }),
    ).not.toThrow();
  });

  it('serializes an action with a per-source lock', () => {
    const root = temporaryRoot();
    expect(withSourceLock(join(root, 'cache', 'entry'), () => 'done')).toBe('done');
    expect(existsSync(join(root, 'cache', 'entry.outfitter.lock'))).toBe(false);
  });

  it('waits for a concurrent holder of the same source lock', async () => {
    const root = temporaryRoot();
    const cachePath = join(root, 'cache', 'entry');
    const lock = `${cachePath}.outfitter.lock`;
    mkdirSync(dirname(lock), { recursive: true });
    const child = spawn(process.execPath, [
      '-e',
      `const fs=require('fs');const p=process.argv[1];const fd=fs.openSync(p,'wx');console.log('ready');setTimeout(()=>{fs.closeSync(fd);fs.unlinkSync(p)},100)`,
      lock,
    ]);
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    expect(withSourceLock(cachePath, () => 'after')).toBe('after');
  });

  it('repairs legacy, partial, wrong-head, and changed-pin caches without touching local sources', () => {
    const root = temporaryRoot();
    const origin = repository(root);
    const locations = configure(root, origin.uri, origin.commit);
    const first = { uri: origin.uri, ref: origin.commit } as const;
    const firstCache = createRemoteRepositoryCachePath(locations.home, first);
    runGit(['clone', '--quiet', origin.uri, firstCache]);
    prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' });

    write(join(firstCache, 'new-file'), 'wrong head');
    runGit(['-C', firstCache, 'add', '.']);
    runGit([
      '-C',
      firstCache,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--quiet',
      '-m',
      'wrong',
    ]);
    prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' });
    expect(runGit(['-C', firstCache, 'rev-parse', 'HEAD'])).toBe(origin.commit);

    write(join(root, 'origin', 'skills', 'next', 'SKILL.md'), '---\nname: next\n---\n');
    runGit(['-C', join(root, 'origin'), 'add', '.']);
    runGit([
      '-C',
      join(root, 'origin'),
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--quiet',
      '-m',
      'next',
    ]);
    const secondCommit = runGit(['-C', join(root, 'origin'), 'rev-parse', 'HEAD']);
    configure(root, origin.uri, secondCommit);
    prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' });
    expect(existsSync(firstCache)).toBe(true);
    expect(existsSync(createRemoteRepositoryCachePath(locations.home, { uri: origin.uri, ref: secondCommit }))).toBe(
      true,
    );

    const local = join(root, 'local-authority');
    write(join(local, 'keep'), 'untouched');
    write(join(locations.home, '.agents', 'settings.yml'), `sources:\n  - path: ${local}\n`);
    prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' });
    expect(String(readFileSync(join(local, 'keep')))).toBe('untouched');

    const partial = { uri: origin.uri, ref: secondCommit } as const;
    const partialCache = createRemoteRepositoryCachePath(locations.home, partial);
    rmSync(partialCache, { recursive: true });
    mkdirSync(join(partialCache, '.git'), { recursive: true });
    expect(inspectSourceCache({ homeDirectory: locations.home, cachePath: partialCache, source: partial }).health).toBe(
      'missing',
    );
    configure(root, origin.uri, secondCommit);
    prepareSourceCaches({ homeDirectory: locations.home, projectDirectory: locations.project, policy: 'repair' });
    expect(inspectSourceCache({ homeDirectory: locations.home, cachePath: partialCache, source: partial }).health).toBe(
      'healthy',
    );
  });

  it('rejects malformed and mismatched state manifests', () => {
    const root = temporaryRoot();
    const origin = repository(root);
    const source = { uri: origin.uri } as const;
    const cachePath = createRemoteRepositoryCachePath(join(root, 'home'), source);
    mkdirSync(dirname(cachePath), { recursive: true });
    runGit(['clone', '--quiet', origin.uri, cachePath]);
    expect(inspectSourceCache({ homeDirectory: join(root, 'home'), cachePath, source }).health).toBe('legacy');

    const statePath = sourceStatePath(join(root, 'home'), source);
    for (const invalid of [
      '{',
      '{}',
      '{"version":1}',
      '{"version":1,"source":"x"}',
      '{"version":1,"source":"x","requestedRef":4}',
      '{"version":1,"source":"x","requestedRef":null,"resolvedCommit":4}',
      '{"version":1,"source":"x","requestedRef":null,"resolvedCommit":"x","cacheKey":4}',
    ]) {
      write(statePath, invalid);
      expect(readSourceState(statePath)).toBeUndefined();
    }

    writeSourceState({ homeDirectory: join(root, 'home'), source, commit: origin.commit });
    const manifest = readSourceState(statePath)!;
    for (const changed of [
      { ...manifest, source: 'different' },
      { ...manifest, requestedRef: 'different' },
      { ...manifest, cacheKey: 'different' },
      { ...manifest, resolvedCommit: '0'.repeat(40) },
    ]) {
      write(statePath, JSON.stringify(changed));
      expect(inspectSourceCache({ homeDirectory: join(root, 'home'), cachePath, source }).health).toBe('mismatched');
    }
    expect(readSourceState(join(root, 'absent'))).toBeUndefined();
  });
});
