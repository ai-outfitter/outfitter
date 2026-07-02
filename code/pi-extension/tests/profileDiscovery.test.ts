// Unit tests for profile catalog discovery and label formatting.
import { describe, expect, it } from 'vitest';

import { discoverProfileChoices, formatProfileLabel, readCurrentDefaultProfile } from '../src/profileDiscovery.js';
import type { OnboardingFs, OutfitterPaths } from '../src/types.js';

interface FakeEntry {
  readonly kind: 'directory' | 'file' | 'special';
  readonly content?: string;
}

const createFakeFs = (entries: Readonly<Record<string, FakeEntry>>): OnboardingFs => ({
  existsSync: (path) => entries[path] !== undefined,
  mkdirSync: () => undefined,
  readFileSync: (path) => {
    const entry = entries[path];
    if (entry?.content === undefined) {
      throw new Error(`unreadable path ${path}`);
    }
    return entry.content;
  },
  readdirSync: (path) => {
    if (entries[path] === undefined) {
      throw new Error(`unreadable directory ${path}`);
    }
    return Object.keys(entries)
      .filter((candidate) => candidate.startsWith(`${path}/`) && !candidate.slice(path.length + 1).includes('/'))
      .map((candidate) => candidate.slice(path.length + 1));
  },
  statSync: (path) => {
    const entry = entries[path];
    if (entry === undefined) {
      throw new Error(`unstattable path ${path}`);
    }
    return {
      isDirectory: () => entry.kind === 'directory',
      isFile: () => entry.kind === 'file',
    };
  },
  writeFileSync: () => undefined,
  dirname: (path) => path.split('/').slice(0, -1).join('/'),
  join: (...segments) => segments.join('/'),
});

const createPaths = (defaultProfilesPath: string | undefined): OutfitterPaths => ({
  homeSettingsPath: '/home/.outfitter/settings.yml',
  homeProfilesPath: '/home/.outfitter/profiles',
  projectSettingsPath: '/project/.outfitter/settings.yml',
  projectProfilesPath: '/project/.outfitter/profiles',
  defaultProfilesPath,
});

describe('discoverProfileChoices', () => {
  it('reads directory and loose-file profiles, filters templates and unsafe ids, and sorts founder first', () => {
    const fs = createFakeFs({
      '/catalog': { kind: 'directory' },
      '/catalog/founder': { kind: 'directory' },
      '/catalog/founder/profile.yml': { kind: 'file', content: 'id: founder\nlabel: Founder\n' },
      '/catalog/empty_dir': { kind: 'directory' },
      '/catalog/analyst.yml': {
        kind: 'file',
        content: "label: 'Analyst'\ndescription: Data work\n",
      },
      '/catalog/template.yaml': { kind: 'file', content: 'id: starter_template\ntemplate: true\n' },
      '/catalog/unsafe.yml': { kind: 'file', content: 'id: ../escape\n' },
      '/catalog/profile.yml': { kind: 'file', content: 'id: ignored-top-level\n' },
      '/catalog/notes.txt': { kind: 'file', content: 'not yaml' },
      '/catalog/socket': { kind: 'special' },
    });

    const profiles = discoverProfileChoices(fs, createPaths('/catalog'), undefined);

    expect(profiles.map((profile) => profile.id)).toEqual(['founder', 'analyst']);
    expect(profiles[1]).toEqual({ id: 'analyst', label: 'Analyst', description: 'Data work' });
  });

  it('orders founder and the current default first regardless of comparison direction', () => {
    const founderLast = createFakeFs({
      '/catalog': { kind: 'directory' },
      '/catalog/aaa.yml': { kind: 'file', content: 'id: aaa\n' },
      '/catalog/founder.yml': { kind: 'file', content: 'id: founder\n' },
    });
    expect(discoverProfileChoices(founderLast, createPaths('/catalog'), undefined).map((p) => p.id)).toEqual([
      'founder',
      'aaa',
    ]);

    const founderFirst = createFakeFs({
      '/catalog': { kind: 'directory' },
      '/catalog/founder.yml': { kind: 'file', content: 'id: founder\n' },
      '/catalog/zzz.yml': { kind: 'file', content: 'id: zzz\n' },
    });
    expect(discoverProfileChoices(founderFirst, createPaths('/catalog'), undefined).map((p) => p.id)).toEqual([
      'founder',
      'zzz',
    ]);

    const defaultFirst = createFakeFs({
      '/catalog': { kind: 'directory' },
      '/catalog/def.yml': { kind: 'file', content: 'id: def\n' },
      '/catalog/zzz.yml': { kind: 'file', content: 'id: zzz\n' },
    });
    expect(discoverProfileChoices(defaultFirst, createPaths('/catalog'), 'def').map((p) => p.id)).toEqual([
      'def',
      'zzz',
    ]);
  });

  it('prefers the current default profile in the sort order and merges duplicate ids', () => {
    const fs = createFakeFs({
      '/catalog': { kind: 'directory' },
      '/catalog/alpha.yml': { kind: 'file', content: 'id: shared\nlabel: Alpha Label\n' },
      '/catalog/beta.yml': { kind: 'file', content: 'id: shared\ndescription: Beta description\n' },
      '/catalog/founder.yml': { kind: 'file', content: 'id: founder\n' },
      '/catalog/zulu.yml': { kind: 'file', content: 'id: zulu\n' },
    });

    const profiles = discoverProfileChoices(fs, createPaths('/catalog'), 'zulu');

    expect(profiles.map((profile) => profile.id)).toEqual(['zulu', 'founder', 'shared']);
    expect(profiles[2]).toEqual({ id: 'shared', label: 'Alpha Label', description: 'Beta description' });
  });

  it('returns no profiles for missing catalogs, unreadable directories, and unstattable entries', () => {
    expect(discoverProfileChoices(createFakeFs({}), createPaths(undefined), undefined)).toEqual([]);
    expect(discoverProfileChoices(createFakeFs({}), createPaths('/missing'), undefined)).toEqual([]);

    const unreadable: OnboardingFs = {
      ...createFakeFs({ '/catalog': { kind: 'directory' } }),
      readdirSync: () => {
        throw new Error('permission denied');
      },
    };
    expect(discoverProfileChoices(unreadable, createPaths('/catalog'), undefined)).toEqual([]);

    const unstattable: OnboardingFs = {
      ...createFakeFs({ '/catalog': { kind: 'directory' }, '/catalog/gone.yml': { kind: 'file', content: 'id: x\n' } }),
      statSync: () => {
        throw new Error('dangling symlink');
      },
    };
    expect(discoverProfileChoices(unstattable, createPaths('/catalog'), undefined)).toEqual([]);
  });
});

describe('readCurrentDefaultProfile', () => {
  it('reads and unquotes the configured default profile', () => {
    const fs = createFakeFs({
      '/settings.yml': { kind: 'file', content: "profile_sources: []\ndefault_profile: 'founder' # comment\n" },
    });

    expect(readCurrentDefaultProfile('/settings.yml', fs.existsSync, fs.readFileSync)).toBe('founder');
    expect(readCurrentDefaultProfile('/missing.yml', fs.existsSync, fs.readFileSync)).toBeUndefined();
  });

  it('returns undefined when no default profile is configured', () => {
    const fs = createFakeFs({ '/settings.yml': { kind: 'file', content: 'profile_sources: []\n' } });

    expect(readCurrentDefaultProfile('/settings.yml', fs.existsSync, fs.readFileSync)).toBeUndefined();
  });
});

describe('formatProfileLabel', () => {
  it('marks the current default, the founder recommendation, and optional labels', () => {
    expect(formatProfileLabel({ id: 'founder', label: 'Founder' }, undefined)).toBe('founder — Founder (Recommended)');
    expect(formatProfileLabel({ id: 'founder' }, 'founder')).toBe('founder (current)');
    expect(formatProfileLabel({ id: 'engineer' }, 'founder')).toBe('engineer');
  });
});
