// Tests dotted agent-slug validation, inheritance, resolution, and Pi delegate materialization.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import { compose } from '../../src/composer/Composer.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import { isAgentDefinitionIssue, parseAgentDefinition } from '../../src/resolver/AgentDefinition.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';

const fixtureCatalog = fileURLToPath(new URL('../fixtures/catalogs/namespaced-agent-slugs', import.meta.url));
const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-namespaced-agent-'));
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

describe('dot-namespaced agent slugs', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.2, OFTR-003.5, OFTR-003.9, OFTR-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes and strictly validates a dotted parent, then round-trips its Pi delegate filename', () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'settings.yml'), `sources:\n  - path: ${JSON.stringify(fixtureCatalog)}\n`);

    const set = resolveResources(
      discoverLayers({
        homeDirectory: home,
        projectDirectory: project,
        settings: { sources: [{ path: fixtureCatalog }] },
      }).layers,
    );
    expect(findResource(set, 'agent', 'environment.sample')?.winner.path).toBe(
      join(fixtureCatalog, 'agents', 'environment.sample', 'agent.md'),
    );

    const composed = compose(set, 'plain-agent', { projectDirectory: project });
    expect(composed.errors).toEqual([]);
    expect(composed.warnings).toEqual([]);
    expect(composed.plan?.inheritanceChain).toEqual(['environment.sample', 'plain-agent']);
    expect(composed.plan?.identity.agentBodies?.map((body) => body.declaringAgent)).toEqual([
      'environment.sample',
      'plain-agent',
    ]);
    expect(executeValidateCommand({ homeDirectory: home, projectDirectory: project, strict: true })).toMatchObject({
      ok: true,
      findings: [],
    });

    const runtimeRoot = join(root, 'runtime');
    const projection = projectComposition(composed.plan!, {
      harness: 'pi',
      rootDirectory: runtimeRoot,
      homeDirectory: home,
    });
    expect(projection.unsupported).toEqual([]);

    const delegateNames = readdirSync(join(runtimeRoot, 'agents'))
      .filter((fileName) => fileName.endsWith('.md'))
      .map((fileName) => fileName.replace(/\.md$/u, ''));
    expect(delegateNames).toEqual(['environment.sample']);
    const delegatePath = join(runtimeRoot, 'agents', 'environment.sample.md');
    const roundTripped = parseAgentDefinition(readFileSync(delegatePath, 'utf8'), [], delegatePath);
    expect(isAgentDefinitionIssue(roundTripped)).toBe(false);
    if (isAgentDefinitionIssue(roundTripped)) return;
    expect(roundTripped.name).toBe('environment.sample');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it.each(['.leading', 'double..dot', 'trailing.'])('rejects invalid dotted name %s', (name) => {
    const parsed = parseAgentDefinition(`---\nname: ${name}\n---\n`, [], '/catalog/agents/invalid/agent.md');
    expect(isAgentDefinitionIssue(parsed)).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.2, OFTR-003.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it.each(['inherits: environment.sample', 'inherits: [environment.sample]'])(
    'accepts a dotted inheritance reference as %s',
    (inherits) => {
      const parsed = parseAgentDefinition(
        `---\nname: plain-agent\n${inherits}\n---\n`,
        [],
        '/catalog/agents/plain-agent/agent.md',
      );
      expect(isAgentDefinitionIssue(parsed)).toBe(false);
    },
  );
});
