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
  const root = mkdtempSync(join(tmpdir(), 'outfitter-compositeProfile-file-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('compositeProfile file assembly', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.2, OFTR-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('represents compositeProfile files with source inputs, output paths, and transform strategy', () => {
    const compositeProfileFile = createCompositeProfileFile({
      rootDirectory: '/tmp/outfitter-default-pi-abc',
      relativePath: 'outfitter/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      strategy: 'transform',
    });

    expect(compositeProfileFile).toEqual({
      relativePath: 'outfitter/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      outputPath: '/tmp/outfitter-default-pi-abc/outfitter/profile.json',
      strategy: 'transform',
    });
    expect(createCompositeProfileFile('EMPTY.md')).toMatchObject({ content: '', outputPath: 'EMPTY.md' });
    expect(createCompositeProfileFile({ relativePath: 'generated.txt', content: 'hello' })).toMatchObject({
      sourceInputs: [],
      strategy: 'generate',
    });
    expect(assembleCompositeProfile({ files: [] }).rootDirectory).toContain('outfitter-profile-agent-');

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
