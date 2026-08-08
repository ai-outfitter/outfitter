// Tests the ownership manifest that makes "unmanaged" decidable across `outfitter link` runs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MANIFEST_VERSION,
  emptyManifest,
  managedTargets,
  readManifest,
  removeManifest,
  resolveManifestPath,
  resolveOutfitterStateDir,
  writeManifest,
} from '../../src/harness/LinkManifest.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-manifest-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const entry = (target: string): Parameters<typeof writeManifest>[1]['entries'][number] => ({
  target,
  harness: 'claude',
  kind: 'skills',
  strategy: 'symlink',
  source: '/catalog/skills/x',
});

describe('link manifest', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('stores machine-local state outside the .agents tree', () => {
    expect(resolveOutfitterStateDir({ XDG_STATE_HOME: '/xdg/state' }, '/home/me')).toBe(
      join('/xdg/state', 'outfitter'),
    );
    expect(resolveOutfitterStateDir({}, '/home/me')).toBe(join('/home/me', '.local', 'state', 'outfitter'));
    expect(resolveOutfitterStateDir({ XDG_STATE_HOME: '  ' }, '/home/me')).toBe(
      join('/home/me', '.local', 'state', 'outfitter'),
    );

    const manifestPath = resolveManifestPath({}, '/home/me');
    expect(manifestPath).toBe(join('/home/me', '.local', 'state', 'outfitter', 'links.json'));
    expect(manifestPath).not.toContain(`${join('/home/me', '.agents')}${'/'}`);
  });

  it('round-trips entries and sorts them deterministically by target', () => {
    const path = join(createTemporaryRoot(), 'state', 'links.json');
    writeManifest(path, { version: MANIFEST_VERSION, entries: [entry('/b'), entry('/a')] });

    expect(readManifest(path).entries.map((item) => item.target)).toEqual(['/a', '/b']);
    expect(readFileSync(path, 'utf8').endsWith('\n')).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('treats a missing, unreadable, or malformed manifest as nothing managed', () => {
    const root = createTemporaryRoot();

    expect(readManifest(join(root, 'absent.json'))).toEqual(emptyManifest());

    const cases = ['not json', '[]', 'null', '{"version":99,"entries":[]}', '{"version":1,"entries":{}}'];

    for (const [index, content] of cases.entries()) {
      const path = join(root, `case-${index}.json`);
      writeFileSync(path, content);
      expect(readManifest(path)).toEqual(emptyManifest());
    }

    // A directory in place of the file surfaces as "nothing managed" rather than throwing.
    const directoryPath = join(root, 'directory.json');
    mkdirSync(directoryPath);
    expect(readManifest(directoryPath)).toEqual(emptyManifest());
  });

  it('drops entries missing required fields rather than trusting them', () => {
    const path = join(createTemporaryRoot(), 'links.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: MANIFEST_VERSION,
        entries: [entry('/good'), { target: '/bad' }, null, 'nope'],
      }),
    );

    expect(readManifest(path).entries.map((item) => item.target)).toEqual(['/good']);
  });

  it('removes the manifest without failing when it is already absent', () => {
    const path = join(createTemporaryRoot(), 'links.json');
    writeManifest(path, { version: MANIFEST_VERSION, entries: [entry('/a')] });
    removeManifest(path);
    expect(existsSync(path)).toBe(false);
    expect(() => removeManifest(path)).not.toThrow();
  });

  it('indexes managed targets for constant-time ownership checks', () => {
    const index = managedTargets({ version: MANIFEST_VERSION, entries: [entry('/a')] });
    expect(index.has('/a')).toBe(true);
    expect(index.has('/b')).toBe(false);
  });
  it('keeps duplicate targets stable when sorting', () => {
    const path = join(createTemporaryRoot(), 'links.json');
    writeManifest(path, { version: MANIFEST_VERSION, entries: [entry('/same'), entry('/same')] });

    expect(readManifest(path).entries).toHaveLength(2);
  });
});
