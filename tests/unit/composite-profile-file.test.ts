// Tests compositeProfile file assembly primitives.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import {
  assembleCompositeProfile,
  writeCompositeProfile,
} from '../../src/compositeProfile/CompositeProfileAssembler.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'applepi-compositeProfile-file-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('compositeProfile file assembly', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.2, APPLEPI-REQ-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('represents compositeProfile files with source inputs, output paths, and transform strategy', () => {
    const compositeProfileFile = createCompositeProfileFile({
      rootDirectory: '/tmp/applepi-default-pi-abc',
      relativePath: 'applepi/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      strategy: 'transform',
    });

    expect(compositeProfileFile).toEqual({
      relativePath: 'applepi/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      outputPath: '/tmp/applepi-default-pi-abc/applepi/profile.json',
      strategy: 'transform',
    });
    expect(createCompositeProfileFile('EMPTY.md')).toMatchObject({ content: '', outputPath: 'EMPTY.md' });
    expect(createCompositeProfileFile({ relativePath: 'generated.txt', content: 'hello' })).toMatchObject({
      sourceInputs: [],
      strategy: 'generate',
    });
    expect(assembleCompositeProfile({ files: [] }).rootDirectory).toContain('applepi-profile-agent-');

    const root = createTemporaryRoot();
    expect(() =>
      writeCompositeProfile(
        createCompositeProfile(join(root, 'compositeProfile'), [
          createCompositeProfileFile({
            rootDirectory: join(root, 'other'),
            relativePath: 'outside.txt',
            content: 'nope',
          }),
        ]),
      ),
    ).toThrow('must stay under compositeProfile root');
  });
});
