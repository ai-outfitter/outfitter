// Tests for the initial Bridl CLI shell and package foundation.
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

interface PackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
  scripts: Record<string, string>;
}

interface PackageLockJson {
  lockfileVersion: number;
  packages: Record<string, unknown>;
}

interface TypeScriptConfig {
  compilerOptions: Record<string, unknown>;
  include?: string[];
}

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;

const packageJson = readJson<PackageJson>('../package.json');
const packageLockJson = readJson<PackageLockJson>('../package-lock.json');
const tsconfig = readJson<TypeScriptConfig>('../tsconfig.json');
const buildTsconfig = readJson<TypeScriptConfig>('../tsconfig.build.json');
const eslintConfigSource = readFileSync(new URL('../eslint.config.js', import.meta.url), 'utf8');
const vitestConfigSource = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8');

describe('project foundation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-001.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('declares the runtime, package manager, and TypeScript build baseline', () => {
    expect(packageJson.engines.node).toBe('>=22.19.0');
    expect(packageLockJson.lockfileVersion).toBeGreaterThanOrEqual(3);
    expect(packageLockJson.packages).toHaveProperty('');
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(buildTsconfig.compilerOptions.rootDir).toBe('src');
    expect(buildTsconfig.compilerOptions.outDir).toBe('dist');
    expect(buildTsconfig.compilerOptions.types).toEqual(['node']);
    expect(buildTsconfig.include).toEqual(['src/**/*.ts']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-001.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('configures Vitest and V8 coverage enforcement', () => {
    expect(packageJson.scripts.test).toBe('vitest --run');
    expect(packageJson.scripts.coverage).toBe('vitest --run --coverage');
    expect(packageJson.devDependencies).toHaveProperty('vitest');
    expect(packageJson.devDependencies).toHaveProperty('@vitest/coverage-v8');
    expect(vitestConfigSource).toContain('all: true');
    expect(vitestConfigSource).toContain("include: ['src/**/*.ts']");
    expect(vitestConfigSource).toContain("provider: 'v8'");
    expect(vitestConfigSource).toContain('statements: 100');
    expect(vitestConfigSource).toContain('branches: 100');
    expect(vitestConfigSource).toContain('functions: 100');
    expect(vitestConfigSource).toContain('lines: 100');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-001.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('configures ESLint with TypeScript support and complexity enforcement', () => {
    expect(packageJson.scripts.lint).toBe('eslint .');
    expect(packageJson.devDependencies).toHaveProperty('eslint');
    expect(packageJson.devDependencies).toHaveProperty('@eslint/js');
    expect(packageJson.devDependencies).toHaveProperty('typescript-eslint');
    expect(eslintConfigSource).toContain("complexity: ['error', 10]");
  });

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
