#!/usr/bin/env bun

// Installs this checkout as the active global outfitter command for local development.
// `bun link` registers this working tree and links package.json#bin into bun's
// global bin directory, so rebuilding `dist/` in this checkout immediately updates
// the globally linked `outfitter` executable.
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const run = (command: string, args: readonly string[], options: { capture?: boolean } = {}): string => {
  console.log(`$ ${[command, ...args].join(' ')}`);
  return execFileSync(command, [...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.capture === true ? 'pipe' : 'inherit',
  }) as string;
};

// Build first so the linked bin target exists and reflects the current source.
run('bun', ['run', 'build']);

// `bun link` registers this checkout as a linkable package and installs its bins
// into the global bun bin directory.
run('bun', ['link']);

// Smoke-test the command through the globally linked bin. This catches stale bin
// targets and symlink-entrypoint bugs before the user starts manual testing.
run('outfitter', ['--version']);
run('outfitter', ['--help']);

console.log('\noutfitter is globally linked to this checkout.');
console.log('After source changes, run `bun run build` to refresh the linked dist/ output.');
