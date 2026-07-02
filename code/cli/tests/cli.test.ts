// Tests for the initial Outfitter CLI shell and package foundation.
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createProgram, isDirectCliExecution } from '../src/cli.js';

interface PackageJson {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
  files: string[];
  keywords: string[];
  pi?: {
    prompts?: string[];
    skills?: string[];
  };
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
const packageLockJson = readJson<PackageLockJson>('../../../package-lock.json');
const tsconfig = readJson<TypeScriptConfig>('../tsconfig.json');
const buildTsconfig = readJson<TypeScriptConfig>('../tsconfig.build.json');
const eslintConfigSource = readFileSync(new URL('../eslint.config.js', import.meta.url), 'utf8');
const vitestConfigSource = readFileSync(new URL('../vitest.config.ts', import.meta.url), 'utf8');

describe('project foundation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('declares the runtime, package manager, and TypeScript build baseline', () => {
    expect(packageJson.engines.node).toBe('>=22.19.0');
    expect(packageLockJson.lockfileVersion).toBeGreaterThanOrEqual(3);
    expect(packageLockJson.packages).toHaveProperty('');
    expect(packageLockJson.packages).toHaveProperty('code/cli');
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(buildTsconfig.compilerOptions.rootDir).toBe('src');
    expect(buildTsconfig.compilerOptions.outDir).toBe('dist');
    expect(buildTsconfig.compilerOptions.types).toEqual(['node']);
    expect(packageJson.scripts.build).toContain('shx cp src/schemas/*.json dist/schemas/');
    expect(packageJson.scripts.prepare).toBe('npm run build');
    expect(packageJson.scripts.dev_install).toBe('node scripts/dev-install.mjs');
    expect(buildTsconfig.include).toEqual(['src/**/*.ts']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('configures Vitest and V8 coverage enforcement', () => {
    expect(packageJson.scripts.test).toBe('vitest --run');
    expect(packageJson.scripts.coverage).toBe('vitest --run --coverage');
    expect(packageJson.devDependencies).toHaveProperty('vitest');
    expect(packageJson.devDependencies).toHaveProperty('@vitest/coverage-v8');
    expect(vitestConfigSource).toContain('all: true');
    expect(vitestConfigSource).toContain("include: ['src/**/*.ts']");
    expect(vitestConfigSource).toContain("provider: 'v8'");
    expect(vitestConfigSource).toContain('statements: 98');
    expect(vitestConfigSource).toContain('branches: 98');
    expect(vitestConfigSource).toContain('functions: 98');
    expect(vitestConfigSource).toContain('lines: 98');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('configures ESLint with TypeScript support and complexity enforcement', () => {
    expect(packageJson.scripts.lint).toBe('eslint .');
    expect(packageJson.devDependencies).toHaveProperty('eslint');
    expect(packageJson.devDependencies).toHaveProperty('@eslint/js');
    expect(packageJson.devDependencies).toHaveProperty('typescript-eslint');
    expect(eslintConfigSource).toContain("complexity: ['error', 10]");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.5, as amended 2026-07-01).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('declares the amended dependency set and Commander-based CLI shell', () => {
    const requiredDependencies = ['ajv', 'chalk', 'commander', 'cross-spawn', 'yaml'];

    for (const dependency of requiredDependencies) {
      expect(packageJson.dependencies).toHaveProperty(dependency);
    }

    // The 2026-07-01 amendment to OFTR-001.5 removed the never-imported packages
    // and requires that no unused production dependencies are declared.
    for (const removedDependency of ['defu', 'glob', 'hosted-git-info', 'typebox']) {
      expect(packageJson.dependencies).not.toHaveProperty(removedDependency);
    }

    const program = createProgram();

    expect(program.name()).toBe('outfitter');
    expect(program.description()).toContain('Profile-oriented wrapper');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('publishes the default Outfitter Pi skill', () => {
    expect(packageJson.files).toContain('skills');
    expect(packageJson.keywords).toContain('pi-package');
    expect(packageJson.pi?.skills).toEqual(['./skills']);
    expect(existsSync(new URL('../skills/outfitter/SKILL.md', import.meta.url))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-001.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('recognizes direct CLI execution through npm global symlinks', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'outfitter-cli-symlink-'));
    const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    const symlinkPath = join(temporaryDirectory, 'outfitter');
    try {
      symlinkSync(cliPath, symlinkPath);

      expect(isDirectCliExecution(pathToFileURL(cliPath).href, symlinkPath)).toBe(true);
      expect(isDirectCliExecution(pathToFileURL(cliPath).href, join(temporaryDirectory, 'missing'))).toBe(false);
      expect(isDirectCliExecution(pathToFileURL(cliPath).href, undefined)).toBe(false);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
