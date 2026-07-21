// Tests the XDG cache path resolution for Outfitter build artifacts (installed pi extensions).
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveOutfitterCacheDir } from '../../src/paths/OutfitterCache.js';

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
