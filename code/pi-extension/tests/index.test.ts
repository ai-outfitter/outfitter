// Tests for the bundled artifact entry point: env-driven config loading.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import outfitter from '../src/index.js';
import { createMockPi } from './harness.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-extension-entry-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  vi.unstubAllEnvs();
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('extension entry point', () => {
  it('activates the extension from the config referenced by OUTFITTER_PI_EXTENSION_CONFIG', () => {
    const root = createTemporaryRoot();
    const configPath = join(root, 'outfitter-extension.config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        autoOpenOutfitter: false,
        homeDirectory: root,
        projectDirectory: root,
        startupAsciiArt: true,
        defaultSettingsTemplate: 'default_profile: __OUTFITTER_PROFILE_ID__\n',
        asciiArt: 'ART',
      }),
    );
    vi.stubEnv('OUTFITTER_PI_EXTENSION_CONFIG', configPath);
    const pi = createMockPi();

    outfitter(pi.api);

    expect(Object.keys(pi.commands)).toEqual(['outfitter', 'mode']);
    expect(Object.keys(pi.handlers)).toEqual(['project_trust', 'session_start', 'tool_call', 'context']);
  });

  it('fails loudly when the config path env var is missing or empty', () => {
    const pi = createMockPi();
    vi.stubEnv('OUTFITTER_PI_EXTENSION_CONFIG', '');
    expect(() => outfitter(pi.api)).toThrow('Outfitter Pi extension config path is missing.');

    delete process.env.OUTFITTER_PI_EXTENSION_CONFIG;
    expect(() => outfitter(pi.api)).toThrow('Outfitter Pi extension config path is missing.');
  });
});
