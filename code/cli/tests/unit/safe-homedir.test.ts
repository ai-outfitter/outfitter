// Tests the crash-safe home directory resolution helper.
import { homedir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { safeHomedir } from '../../src/fs/SafeHomedir.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe('safeHomedir', () => {
  it('returns the native home directory when os.homedir succeeds', () => {
    expect(safeHomedir()).toBe(homedir());
    expect(safeHomedir(() => '/custom/home')).toBe('/custom/home');
  });

  it('falls back to $HOME when os.homedir throws', () => {
    process.env.HOME = '/env/home';

    expect(
      safeHomedir(() => {
        throw new Error('ENOENT: no home directory for uid');
      }),
    ).toBe('/env/home');
  });

  it('falls back to the current directory when os.homedir throws and HOME is unset', () => {
    delete process.env.HOME;

    expect(
      safeHomedir(() => {
        throw new Error('ENOENT: no home directory for uid');
      }),
    ).toBe('.');
  });
});
