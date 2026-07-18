// Tests the process-derived command default helpers.
import { homedir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { resolveHomeDirectory, resolveProjectDirectory } from '../../src/cli/commands/ProcessDefaults.js';

describe('process defaults', () => {
  it('uses the provided value or falls back to the process default', () => {
    expect(resolveHomeDirectory('/explicit/home')).toBe('/explicit/home');
    expect(resolveHomeDirectory()).toBe(homedir());
    expect(resolveProjectDirectory('/explicit/project')).toBe('/explicit/project');
    expect(resolveProjectDirectory()).toBe(process.cwd());
  });
});
