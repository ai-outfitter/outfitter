// Tests validation against the provenance-aware effective inheritance composition.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';

const roots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-inheritance-validation-'));
  roots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('inheritance validation', () => {
  it('validates inherited skills after parent-first de-duplication', () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'base', 'agent.md'), '---\nname: base\nskills: [private]\n---\n');
    write(join(project, '.agents', 'agents', 'base', 'skills', 'private', 'SKILL.md'), '---\nname: private\n---\n');
    write(
      join(project, '.agents', 'agents', 'child', 'agent.md'),
      '---\nname: child\ninherits: base\nskills: [private]\n---\n',
    );
    const set = resolveResources(
      discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers,
    );

    const findings = validateEffectiveSet(set);

    expect(
      findings.some(
        (finding) => finding.resource === 'agent:child' && finding.message.includes("unknown skill 'private'"),
      ),
    ).toBe(false);
  });

  it('keeps non-resource composition diagnostics as warnings', () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\nmcp: [missing]\n---\n');
    const set = resolveResources(
      discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers,
    );

    const findings = validateEffectiveSet(set);

    expect(findings).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        resource: 'agent:engineer',
        message: "loadout mcp references unknown server 'missing'.",
      }),
    );
  });
});
