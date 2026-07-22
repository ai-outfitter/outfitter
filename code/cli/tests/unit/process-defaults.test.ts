// Tests the process-derived command default helpers.
import { homedir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveHomeDirectory, resolveProjectDirectory } from '../../src/cli/commands/ProcessDefaults.js';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
});

describe('process defaults', () => {
  it('uses the provided value or falls back to the process default', () => {
    expect(resolveHomeDirectory('/explicit/home')).toBe('/explicit/home');
    expect(resolveHomeDirectory()).toBe(homedir());
    expect(resolveProjectDirectory('/explicit/project')).toBe('/explicit/project');
    expect(resolveProjectDirectory()).toBe(process.cwd());
  });

  it('falls back without crashing when the operating system cannot resolve a home directory', () => {
    process.env.HOME = '/env/home';
    const failingHomedir = (): never => {
      throw new Error('no passwd entry');
    };

    expect(resolveHomeDirectory(undefined, failingHomedir)).toBe('/env/home');
    delete process.env.HOME;
    expect(resolveHomeDirectory(undefined, failingHomedir)).toBe('.');
  });
});
