// Tests for the initial Bridl CLI shell and package foundation.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

interface PackageJson {
  dependencies: Record<string, string>;
}

const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageJson;

describe('project foundation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-001.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('declares the initial dependency set and Commander-based CLI shell', () => {
    const requiredDependencies = [
      'ajv',
      'chalk',
      'commander',
      'cross-spawn',
      'defu',
      'glob',
      'hosted-git-info',
      'yaml',
    ];

    for (const dependency of requiredDependencies) {
      expect(packageJson.dependencies).toHaveProperty(dependency);
    }

    expect(packageJson.dependencies).toHaveProperty('typebox');

    const program = createProgram();

    expect(program.name()).toBe('bridl');
    expect(program.description()).toContain('Profile-oriented wrapper');
  });
});
