// Docs hygiene: guards against reintroducing known path typos anywhere in the repo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TYPO_PATTERN = /archtecture|orginization/i;

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const selfPath = fileURLToPath(import.meta.url);

// Directories that must not be scanned: dependencies, git internals, build
// artifacts, and docs/plans (which intentionally records historical typos).
const excludedDirectories = new Set(['node_modules', '.git', 'dist', 'coverage']);
const excludedRelativePaths = new Set(['docs/plans']);

function collectFiles(directory: string, results: string[]): string[] {
  for (const entry of readdirSync(directory)) {
    const entryPath = join(directory, entry);
    const relativePath = relative(repoRoot, entryPath).split(sep).join('/');
    if (excludedRelativePaths.has(relativePath)) {
      continue;
    }
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      if (!excludedDirectories.has(entry)) {
        collectFiles(entryPath, results);
      }
    } else if (stats.isFile() && entryPath !== selfPath) {
      results.push(entryPath);
    }
  }
  return results;
}

describe('docs hygiene', () => {
  it('contains no known path typos (archtecture, orginization) anywhere in the repo', () => {
    const offenders: string[] = [];
    for (const filePath of collectFiles(repoRoot, [])) {
      const contents = readFileSync(filePath, 'utf8');
      if (TYPO_PATTERN.test(contents)) {
        offenders.push(relative(repoRoot, filePath));
      }
    }
    expect(offenders, `Typo strings found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has no files or directories with typo names', () => {
    const offenders = collectFiles(repoRoot, []).filter((filePath) => TYPO_PATTERN.test(relative(repoRoot, filePath)));
    expect(offenders.map((filePath) => relative(repoRoot, filePath))).toEqual([]);
  });
});
