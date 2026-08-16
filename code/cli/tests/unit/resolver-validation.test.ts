// Tests loadout-resolution deferral: `outfitter sync` validates a source in isolation and must not
// fail an unresolved loadout slug (a transitive dependency may supply it), while resolution does.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';

const temporaryRoots: string[] = [];

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agentMd = (name: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: The ${name} agent.\n${extra}---\n\n# ${name}\n\nBody for ${name}.\n`;

// A project whose `engineer` agent references a skill it does not define (as if it lived in a
// declared dependency), plus a `mislabeled` agent whose name does not match its directory.
const effectiveSet = () => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-resolver-validation-'));
  temporaryRoots.push(root);
  const project = join(root, 'project');
  write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agentMd('engineer', 'skills: [from-dependency]\n'));
  write(join(project, '.agents', 'agents', 'mislabeled', 'agent.md'), agentMd('other'));
  return resolveResources(
    discoverLayers({ homeDirectory: join(root, 'home'), projectDirectory: project, settings: {} }).layers,
  );
};

const engineerLoadout = (findings: ReturnType<typeof validateEffectiveSet>) =>
  findings.filter((f) => f.resource === 'agent:engineer' && f.message.includes("unknown skill 'from-dependency'"));

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loadout resolution deferral', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('treats an unresolved loadout slug as an error by default (merged resolution)', () => {
    expect(engineerLoadout(validateEffectiveSet(effectiveSet()))).toEqual([
      expect.objectContaining({ severity: 'error' }),
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('defers an unresolved loadout slug to a warning while still failing a structural error', () => {
    const findings = validateEffectiveSet(effectiveSet(), undefined, { deferLoadoutResolution: true });

    // The cross-catalog loadout reference is downgraded to a warning under deferral...
    expect(engineerLoadout(findings)).toEqual([expect.objectContaining({ severity: 'warning' })]);
    // ...but a structural error (an agent whose name mismatches its directory) still fails.
    expect(
      findings.some(
        (f) =>
          f.resource === 'agent:mislabeled' && f.severity === 'error' && f.message.includes('must match its directory'),
      ),
    ).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves typed codes and exact declaration paths for composition findings', () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-resolver-outside-'));
    temporaryRoots.push(root);
    const project = join(root, 'project');
    const parentPath = join(project, '.agents', 'agents', 'parent', 'agent.md');
    const childPath = join(project, '.agents', 'agents', 'child', 'agent.md');
    const configPath = join(project, '.agents', 'agents', 'configured', 'config.json');
    const mcpPath = join(project, '.agents', 'agents', 'outside', 'mcp.json');
    write(parentPath, agentMd('parent', 'skills: [from-parent]\nsystem_prompt:\n  file: ../secret.md\n'));
    write(childPath, agentMd('child', 'inherits: [parent]\n'));
    write(join(project, '.agents', 'agents', 'configured', 'agent.md'), agentMd('configured'));
    write(configPath, '{"skills":["from-config"]}\n');
    write(join(project, '.agents', 'agents', 'outside', 'agent.md'), agentMd('outside', 'mcp: [server]\n'));
    write(mcpPath, '{ invalid json');
    const set = resolveResources(
      discoverLayers({ homeDirectory: join(root, 'home'), projectDirectory: project, settings: {} }).layers,
    );

    const findings = validateEffectiveSet(set);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: 'agent:child', code: 'resource-unresolved', sourcePath: parentPath }),
        expect.objectContaining({ resource: 'agent:child', code: 'reference-escaped', sourcePath: parentPath }),
        expect.objectContaining({ resource: 'agent:configured', code: 'resource-unresolved', sourcePath: configPath }),
        expect.objectContaining({ resource: 'agent:outside', code: 'resource-invalid', sourcePath: mcpPath }),
      ]),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('attributes unknown parents and cycles to the agent that declares the failing edge', () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-resolver-inheritance-'));
    temporaryRoots.push(root);
    const project = join(root, 'project');
    const unknownPath = join(project, '.agents', 'agents', 'unknown-child', 'agent.md');
    const cycleBPath = join(project, '.agents', 'agents', 'cycle-b', 'agent.md');
    write(unknownPath, agentMd('unknown-child', 'inherits: [ghost]\n'));
    write(join(project, '.agents', 'agents', 'cycle-a', 'agent.md'), agentMd('cycle-a', 'inherits: [cycle-b]\n'));
    write(cycleBPath, agentMd('cycle-b', 'inherits: [cycle-a]\n'));
    const set = resolveResources(
      discoverLayers({ homeDirectory: join(root, 'home'), projectDirectory: project, settings: {} }).layers,
    );

    const findings = validateEffectiveSet(set);
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resource: 'agent:unknown-child',
          code: 'resource-unresolved',
          sourcePath: unknownPath,
        }),
        expect.objectContaining({ resource: 'agent:cycle-a', code: 'inheritance-cycle', sourcePath: cycleBPath }),
      ]),
    );
  });
});
