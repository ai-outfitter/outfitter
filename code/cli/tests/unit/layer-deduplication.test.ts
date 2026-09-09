// Tests that one physical resource tree cannot shadow itself through multiple layer paths.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { discoverLayers } from '../../src/resolver/Layer.js';

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.3).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('includes one layer when workspace and global resolve to the same physical root', () => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-layer-deduplication-'));
  try {
    const home = join(root, 'home');
    const projectAlias = join(root, 'project-alias');
    mkdirSync(join(home, '.agents'), { recursive: true });
    symlinkSync(home, projectAlias, 'dir');

    const discovered = discoverLayers({
      homeDirectory: home,
      projectDirectory: projectAlias,
      settings: {},
    });

    expect(discovered.layers).toEqual([
      {
        root: join(projectAlias, '.agents'),
        origin: 'workspace',
        label: 'workspace',
      },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
