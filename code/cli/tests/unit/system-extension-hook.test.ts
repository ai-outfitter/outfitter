// Tests system-scope hook discovery, schema validation, and fail-closed file loading.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readSystemExtensionHooks, resolveSystemExtensionHookSource } from '../../src/system/SystemExtensionHook.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-system-hook-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('system extension hook discovery', () => {
  it('prefers OUTFITTER_SYSTEM_DIR and stamps it as an environment override', () => {
    expect(
      resolveSystemExtensionHookSource({ environment: { OUTFITTER_SYSTEM_DIR: '/tmp/hooks' }, platform: 'linux' }),
    ).toEqual({ directory: '/tmp/hooks', stamp: 'env-override:/tmp/hooks' });
  });

  it('uses the operating-system location when there is no override', () => {
    expect(resolveSystemExtensionHookSource({ environment: {}, platform: 'linux' })).toEqual({
      directory: '/etc/outfitter/system.d',
      stamp: '/etc/outfitter/system.d',
    });
    expect(resolveSystemExtensionHookSource({ environment: {}, platform: 'darwin' })).toEqual({
      directory: '/Library/Application Support/Outfitter/system.d',
      stamp: '/Library/Application Support/Outfitter/system.d',
    });
    expect(resolveSystemExtensionHookSource({ environment: {}, platform: 'win32' })).toBeUndefined();
  });
});

describe('readSystemExtensionHooks', () => {
  it('treats an absent hook directory and an unsupported platform as empty', () => {
    const directory = join(temporaryRoot(), 'absent');
    expect(readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toEqual({
      hooks: [],
      source: { directory, stamp: `env-override:${directory}` },
    });
    expect(readSystemExtensionHooks({ environment: {}, platform: 'win32' })).toEqual({ hooks: [] });
  });

  it('loads every yml document additively in lexical order', () => {
    const directory = temporaryRoot();
    const extensionA = join(directory, 'extension-a');
    const extensionB = join(directory, 'extension-b');
    mkdirSync(extensionA);
    mkdirSync(extensionB);
    write(
      join(directory, '20-second.yml'),
      `name: second\nharnesses:\n  pi:\n    extensions: [${extensionB}]\n    env:\n      SECOND: two\n`,
    );
    write(
      join(directory, '10-first.yml'),
      `name: first\nharnesses:\n  pi:\n    extensions: [${extensionA}]\n    env:\n      FIRST: one\n`,
    );
    write(join(directory, 'ignored.yaml'), 'not: read\n');

    const loaded = readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } });

    expect(loaded.hooks.map((hook) => hook.name)).toEqual(['first', 'second']);
    expect(loaded.hooks.map((hook) => hook.harnesses.pi?.extensions?.[0])).toEqual([extensionA, extensionB]);
  });

  it('fails closed for malformed YAML and schema-invalid documents', () => {
    const malformedDirectory = temporaryRoot();
    write(join(malformedDirectory, 'bad.yml'), 'name: [unterminated\n');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: malformedDirectory } })).toThrow(
      /Invalid system extension hook.*YAMLParseError/u,
    );

    const invalidDirectory = temporaryRoot();
    write(join(invalidDirectory, 'bad.yml'), 'name: redirector\nagent: engineer\nharnesses:\n  pi: {}\n');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: invalidDirectory } })).toThrow(
      /additional properties/u,
    );
  });

  it('rejects network specifiers and extension paths that do not exist', () => {
    const networkDirectory = temporaryRoot();
    write(join(networkDirectory, 'network.yml'), 'name: network\nharnesses:\n  pi:\n    extensions: [npm:observer]\n');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: networkDirectory } })).toThrow(
      /pattern/u,
    );

    const missingDirectory = temporaryRoot();
    write(
      join(missingDirectory, 'missing.yml'),
      'name: missing\nharnesses:\n  pi:\n    extensions: [/definitely/not/an/outfitter-extension]\n',
    );
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: missingDirectory } })).toThrow(
      /extension path does not exist/u,
    );
  });

  it('fails closed when the source or a hook document is unreadable', () => {
    const fileSource = join(temporaryRoot(), 'not-a-directory');
    write(fileSource, 'content');
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: fileSource } })).toThrow(
      /is not a directory/u,
    );

    const directory = temporaryRoot();
    mkdirSync(join(directory, 'directory.yml'));
    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toThrow(
      /is unreadable/u,
    );
  });

  it('rejects environment collisions instead of assigning file precedence', () => {
    const directory = temporaryRoot();
    write(join(directory, 'a.yml'), 'name: a\nharnesses:\n  pi:\n    env:\n      SINK: a\n');
    write(join(directory, 'b.yml'), 'name: b\nharnesses:\n  pi:\n    env:\n      SINK: b\n');

    expect(() => readSystemExtensionHooks({ environment: { OUTFITTER_SYSTEM_DIR: directory } })).toThrow(
      /environment 'SINK'.*declared by both/u,
    );
  });

  it('registers the persisted document with the shared schema validator', () => {
    expect(
      validateSchema('system-extension-hook', {
        name: 'pensieve',
        harnesses: { claude: { env: { PENSIEVE_INSTALL_SCOPE: 'launcher' } } },
      }),
    ).toEqual({ valid: true, issues: [] });
  });
});
