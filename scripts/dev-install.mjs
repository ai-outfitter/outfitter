#!/usr/bin/env node

// Installs this checkout as the active global applepi command for local development.
// The command intentionally uses `npm link` rather than `npm install -g .` so the
// global package points at this working tree. Rebuilding `dist/` in this checkout
// immediately updates the globally linked `applepi` executable.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const run = (command, args, options = {}) => {
  console.log(`$ ${[command, ...args].join(' ')}`);
  return execFileSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: options.capture === true ? 'pipe' : 'inherit',
  });
};

// Build first so the linked bin target exists and reflects the current source.
run('npm', ['run', 'build']);

// `npm link` creates a global package symlink back to this checkout and links
// package.json#bin into the global npm bin directory.
run('npm', ['link']);

const globalRoot = run('npm', ['root', '-g'], { capture: true }).trim();
const linkedPackagePath = join(globalRoot, 'applepi');

if (!existsSync(linkedPackagePath)) {
  throw new Error(`Expected npm link to create ${linkedPackagePath}.`);
}

const linkedPackageRealpath = realpathSync(linkedPackagePath);
const projectRealpath = realpathSync(projectRoot);

if (linkedPackageRealpath !== projectRealpath) {
  throw new Error(`Global applepi package points at ${linkedPackageRealpath}, not ${projectRealpath}.`);
}

// Smoke-test the command through the globally linked bin. This catches stale bin
// targets and symlink-entrypoint bugs before the user starts manual testing.
run('applepi', ['--version']);
run('applepi', ['--help']);

console.log('\napplepi is globally linked to this checkout.');
console.log('After source changes, run `npm run build` to refresh the linked dist/ output.');
