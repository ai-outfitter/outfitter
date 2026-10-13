// Tests the process-derived command default helpers.
import { homedir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveHomeDirectory, resolveProjectDirectory } from '../../src/cli/commands/ProcessDefaults.js';

describe('process defaults', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('uses an isolated home without replacing the operating-system home', () => {
    const operatingSystemHome = homedir();
    vi.stubEnv('OUTFITTER_USER_HOME', '/isolated/outfitter');
    expect(resolveHomeDirectory()).toBe('/isolated/outfitter');
    expect(resolveHomeDirectory('/explicit/home')).toBe('/explicit/home');
    expect(homedir()).toBe(operatingSystemHome);
  });
  it('uses the provided value or falls back to the process default', () => {
    vi.stubEnv('OUTFITTER_USER_HOME', '');
    expect(resolveHomeDirectory('/explicit/home')).toBe('/explicit/home');
    expect(resolveHomeDirectory()).toBe(homedir());
    expect(resolveProjectDirectory('/explicit/project')).toBe('/explicit/project');
    expect(resolveProjectDirectory()).toBe(process.cwd());
  });
});
