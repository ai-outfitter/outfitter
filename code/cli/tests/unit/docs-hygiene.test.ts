// Docs hygiene: guards against reintroducing known path typos anywhere in the repo.
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TYPO_PATTERN = /archtecture|orginization/i;

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const selfPath = fileURLToPath(import.meta.url);

// docs/plans intentionally records historical typos and is excluded. Only
// git-tracked files are scanned: untracked scratch files, broken symlinks, and
// symlink cycles in the working tree must not affect the suite.
const excludedPrefixes = ['docs/plans/'];

function collectTrackedFiles(): string[] {
  const output = execFileSync('git', ['-C', repoRoot, 'ls-files', '-z'], { encoding: 'utf8' });
  return output
    .split('\0')
    .filter(Boolean)
    .filter((path) => !excludedPrefixes.some((prefix) => path.startsWith(prefix)))
    .filter((path) => join(repoRoot, path) !== selfPath)
    .filter((path) => {
      const stats = lstatSync(join(repoRoot, path), { throwIfNoEntry: false });
      return stats?.isFile() === true && !stats.isSymbolicLink();
    });
}

describe('docs hygiene', () => {
  it('contains no known path typos (archtecture, orginization) anywhere in the repo', () => {
    const offenders: string[] = [];
    for (const path of collectTrackedFiles()) {
      const contents = readFileSync(join(repoRoot, path), 'utf8');
      if (TYPO_PATTERN.test(contents)) {
        offenders.push(path);
      }
    }
    expect(offenders, `Typo strings found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('has no files or directories with typo names', () => {
    const offenders = collectTrackedFiles().filter((path) => TYPO_PATTERN.test(path));
    expect(offenders).toEqual([]);
  });
});
