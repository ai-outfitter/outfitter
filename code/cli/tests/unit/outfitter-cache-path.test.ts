// Tests the XDG cache path resolution for Outfitter build artifacts (installed pi extensions).
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveOutfitterCacheDir, resolveOutfitterStateDir } from '../../src/paths/OutfitterCache.js';

describe('resolveOutfitterCacheDir', () => {
  it('honors XDG_CACHE_HOME when set', () => {
    expect(resolveOutfitterCacheDir({ XDG_CACHE_HOME: '/xdg/cache' }, '/home/me')).toBe(
      join('/xdg/cache', 'outfitter'),
    );
  });

  it('falls back to <home>/.cache/outfitter when XDG_CACHE_HOME is unset or empty', () => {
    expect(resolveOutfitterCacheDir({}, '/home/me')).toBe(join('/home/me', '.cache', 'outfitter'));
    expect(resolveOutfitterCacheDir({ XDG_CACHE_HOME: '   ' }, '/home/me')).toBe(
      join('/home/me', '.cache', 'outfitter'),
    );
  });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('resolveOutfitterStateDir', () => {
  it('honors a non-blank XDG_STATE_HOME and otherwise uses the home-local state directory', () => {
    expect(resolveOutfitterStateDir({ XDG_STATE_HOME: '/xdg/state' }, '/home/me')).toBe(
      join('/xdg/state', 'outfitter'),
    );
    expect(resolveOutfitterStateDir({}, '/home/me')).toBe(join('/home/me', '.local', 'state', 'outfitter'));
    expect(resolveOutfitterStateDir({ XDG_STATE_HOME: '   ' }, '/home/me')).toBe(
      join('/home/me', '.local', 'state', 'outfitter'),
    );
  });
});
