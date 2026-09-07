import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createListCommand } from '../../src/cli/commands/ListCommand.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-output-type-resources-'));
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

describe('output type resources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.1.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves output types by slug with workspace-over-global shadowing', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'output-types', 'artifact', 'schema.json'), '{"title":"global"}\n');
    write(join(project, '.agents', 'output-types', 'artifact', 'schema.json'), '{"title":"workspace"}\n');

    const layers = discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers;
    const artifact = findResource(resolveResources(layers), 'output-type', 'artifact');

    expect(artifact?.winner.layer.origin).toBe('workspace');
    expect(artifact?.shadowed.map((definition) => definition.layer.origin)).toEqual(['global']);
    expect(artifact?.winner.path).toBe(join(project, '.agents', 'output-types', 'artifact', 'schema.json'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.1.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('list output-types --json emits stable catalog provenance', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'output-types', 'issue', 'schema.json'), '{}\n');
    write(join(project, '.agents', 'output-types', 'git-commit', 'schema.json'), '{}\n');
    const lines: string[] = [];
    const program = new Command();
    createListCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      writeLine: (message) => lines.push(message),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'list', 'output-types', '--json']);

    expect(JSON.parse(lines.join('\n'))).toEqual({
      ok: true,
      resources: [
        {
          kind: 'output-type',
          slug: 'git-commit',
          layer: 'workspace',
          path: join(project, '.agents', 'output-types', 'git-commit', 'schema.json'),
          ownerAgent: null,
        },
        {
          kind: 'output-type',
          slug: 'issue',
          layer: 'workspace',
          path: join(project, '.agents', 'output-types', 'issue', 'schema.json'),
          ownerAgent: null,
        },
      ],
      diagnostics: ['output-types:', '  git-commit  [workspace]', '  issue  [workspace]'],
    });
  });
});
