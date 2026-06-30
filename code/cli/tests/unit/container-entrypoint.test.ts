// Tests the release container entrypoint's runtime identity selection.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const temporaryRoots: string[] = [];
const entrypointPath = resolve('../../bin/outfitter-docker-entrypoint');

interface EntrypointRunResult {
  readonly outfitterLog: string;
  readonly setprivLog: string;
}

interface EntrypointRunOptions {
  readonly omitHome?: boolean;
}

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-entrypoint-'));
  temporaryRoots.push(root);
  return root;
};

const writeExecutable = (path: string, content: string): void => {
  writeFileSync(path, content, { mode: 0o755 });
};

const readOptionalFile = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

const prepareStubCommands = (root: string): string => {
  const binDirectory = join(root, 'bin');
  mkdirSync(binDirectory, { recursive: true });
  writeExecutable(
    join(binDirectory, 'id'),
    [
      '#!/bin/sh',
      'if [ "${1:-}" = "-u" ]; then',
      '  printf "%s\\n" "${FAKE_ID_U:-1000}"',
      'else',
      '  printf "uid=%s\\n" "${FAKE_ID_U:-1000}"',
      'fi',
      '',
    ].join('\n'),
  );
  writeExecutable(
    join(binDirectory, 'stat'),
    [
      '#!/bin/sh',
      'if [ "${1:-}" = "-c" ] && [ "${2:-}" = "%u" ]; then',
      '  printf "%s\\n" "${FAKE_STAT_U:-1000}"',
      '  exit 0',
      'fi',
      'if [ "${1:-}" = "-c" ] && [ "${2:-}" = "%g" ]; then',
      '  printf "%s\\n" "${FAKE_STAT_G:-1000}"',
      '  exit 0',
      'fi',
      'printf "unexpected stat invocation: %s\\n" "$*" >&2',
      'exit 64',
      '',
    ].join('\n'),
  );
  writeExecutable(
    join(binDirectory, 'setpriv'),
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$SETPRIV_LOG"',
      'while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do',
      '  shift',
      'done',
      'if [ "$#" -eq 0 ]; then',
      '  exit 65',
      'fi',
      'shift',
      'exec "$@"',
      '',
    ].join('\n'),
  );
  writeExecutable(
    join(binDirectory, 'outfitter'),
    [
      '#!/bin/sh',
      'printf "args=%s\\n" "$*" >> "$OUTFITTER_LOG"',
      'printf "home=%s\\n" "$HOME" >> "$OUTFITTER_LOG"',
      '',
    ].join('\n'),
  );

  return binDirectory;
};

const runEntrypoint = (
  root: string,
  env: NodeJS.ProcessEnv,
  options: EntrypointRunOptions = {},
): EntrypointRunResult => {
  const homeDirectory = join(root, 'home');
  const workDirectory = join(root, 'work');
  const outfitterLog = join(root, 'outfitter.log');
  const setprivLog = join(root, 'setpriv.log');
  const binDirectory = prepareStubCommands(root);
  mkdirSync(homeDirectory, { recursive: true });
  mkdirSync(workDirectory, { recursive: true });
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
    OUTFITTER_LOG: outfitterLog,
    SETPRIV_LOG: setprivLog,
    ...env,
  };

  if (options.omitHome === true) {
    delete childEnv.HOME;
  } else {
    childEnv.HOME = homeDirectory;
  }

  execFileSync(entrypointPath, ['--profile', 'founder'], {
    cwd: workDirectory,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return {
    outfitterLog: readOptionalFile(outfitterLog),
    setprivLog: readOptionalFile(setprivLog),
  };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-009.4).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('container entrypoint', () => {
  it('defaults HOME to /home/node when the caller does not supply one', () => {
    const root = createTemporaryRoot();

    const result = runEntrypoint(root, { FAKE_ID_U: '1000' }, { omitHome: true });

    expect(result.outfitterLog).toContain('args=--profile founder');
    expect(result.outfitterLog).toContain('home=/home/node');
    expect(result.setprivLog).toBe('');
  });

  it('executes Outfitter directly when the caller already selected a non-root user', () => {
    const root = createTemporaryRoot();

    const result = runEntrypoint(root, { FAKE_ID_U: '1000' });

    expect(result.outfitterLog).toContain('args=--profile founder');
    expect(result.outfitterLog).toContain(`home=${join(root, 'home')}`);
    expect(result.setprivLog).toBe('');
  });

  it('drops from root to the working-directory owner when that owner is non-root', () => {
    const root = createTemporaryRoot();

    const result = runEntrypoint(root, { FAKE_ID_U: '0', FAKE_STAT_U: '1234', FAKE_STAT_G: '5678' });

    expect(result.outfitterLog).toContain('args=--profile founder');
    expect(result.setprivLog).toContain('--reuid=1234');
    expect(result.setprivLog).toContain('--regid=5678');
    expect(result.setprivLog).toContain('--clear-groups');
    expect(result.setprivLog).toContain('--no-new-privs');
    expect(result.setprivLog).toContain('-- outfitter --profile founder');
  });

  it('keeps root when root owns the working directory', () => {
    const root = createTemporaryRoot();

    const result = runEntrypoint(root, { FAKE_ID_U: '0', FAKE_STAT_U: '0', FAKE_STAT_G: '0' });

    expect(result.outfitterLog).toContain('args=--profile founder');
    expect(result.setprivLog).toBe('');
  });
});
