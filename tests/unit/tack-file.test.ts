// Tests tack file assembly primitives.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTack } from '../../src/tack/Tack.js';
import { assembleTack, writeTack } from '../../src/tack/TackAssembler.js';
import { createTackFile } from '../../src/tack/TackFile.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-tack-file-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('tack file assembly', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-005.2, BRIDL-REQ-005.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('represents tack files with source inputs, output paths, and transform strategy', () => {
    const tackFile = createTackFile({
      rootDirectory: '/tmp/bridl-default-pi-abc',
      relativePath: 'bridl/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      strategy: 'transform',
    });

    expect(tackFile).toEqual({
      relativePath: 'bridl/profile.json',
      content: '{}\n',
      sourceInputs: ['/profiles/default/profile.yml'],
      outputPath: '/tmp/bridl-default-pi-abc/bridl/profile.json',
      strategy: 'transform',
    });
    expect(createTackFile('EMPTY.md')).toMatchObject({ content: '', outputPath: 'EMPTY.md' });
    expect(createTackFile({ relativePath: 'generated.txt', content: 'hello' })).toMatchObject({
      sourceInputs: [],
      strategy: 'generate',
    });
    expect(assembleTack({ files: [] }).rootDirectory).toContain('bridl-profile-agent-');

    const root = createTemporaryRoot();
    expect(() =>
      writeTack(
        createTack(join(root, 'tack'), [
          createTackFile({ rootDirectory: join(root, 'other'), relativePath: 'outside.txt', content: 'nope' }),
        ]),
      ),
    ).toThrow('must stay under tack root');
  });
});
