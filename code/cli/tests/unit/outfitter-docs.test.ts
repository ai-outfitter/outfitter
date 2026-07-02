// Tests the agent-readable Outfitter documentation prompt, mirroring pi's own docs mechanism.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createOutfitterDocsSystemPrompt, resolveOutfitterDocsDirectory } from '../../src/agents/OutfitterDocs.js';
import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';

const repositoryDocsDirectory = fileURLToPath(new URL('../../../../docs/documentation', import.meta.url));

describe('outfitter docs prompt', () => {
  it('resolves the repository documentation directory in the source layout', () => {
    expect(resolveOutfitterDocsDirectory()).toBe(repositoryDocsDirectory);
  });

  it('builds guidance that points at the documentation index by absolute path', () => {
    const prompt = createOutfitterDocsSystemPrompt('/opt/outfitter/doc/documentation');

    expect(prompt).toContain('read only when the user asks about Outfitter itself');
    expect(prompt).toContain(`- Documentation index: ${join('/opt/outfitter/doc/documentation', 'README.md')}`);
    expect(prompt).toContain('- Additional docs: /opt/outfitter/doc/documentation');
    expect(prompt).toContain('profiles and profile layouts (profiles.md)');
    expect(prompt).toContain('improving your own active profile (iterating-on-profiles.md)');
    expect(prompt).toContain('read the referenced .md files completely');
  });

  it('appends the docs prompt to pi launch plans when the launch context provides a docs directory', () => {
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      { rootDirectory: '/tmp/outfitter-engineering-pi-docs-prompt', profilePaths: [] },
    );
    const launchPlan = adapter.createLaunchPlan(
      compositeProfilePlan.compositeProfile,
      { id: 'engineering', inherits: [], controls: { appendSystemPrompt: 'profile prompt' } },
      [],
      { outfitterDocsDirectory: repositoryDocsDirectory },
    );

    const appendPrompts = launchPlan.args.filter(
      (_arg, index) => launchPlan.args[index - 1] === '--append-system-prompt',
    );
    expect(appendPrompts[0]).toBe('profile prompt');
    expect(appendPrompts[1]).toContain(`- Additional docs: ${repositoryDocsDirectory}`);
    expect(appendPrompts).toHaveLength(2);
  });

  it('keeps pi launch plans untouched when no docs directory is provided', () => {
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      { rootDirectory: '/tmp/outfitter-engineering-pi-docs-absent', profilePaths: [] },
    );
    const launchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, {
      id: 'engineering',
      inherits: [],
      controls: {},
    });

    expect(launchPlan.args).not.toContain('--append-system-prompt');
  });
});
