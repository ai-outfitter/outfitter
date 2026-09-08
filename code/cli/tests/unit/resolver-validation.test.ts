// Tests dependency-resolution deferral: `outfitter sync` validates a source in isolation and must
// not fail references a transitive dependency may supply, while merged resolution still does.
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
  write(join(project, '.agents', 'agents', 'child', 'agent.md'), agentMd('child', 'inherits: dependency-parent\n'));
  write(join(project, '.agents', 'agents', 'leader', 'agent.md'), agentMd('leader', 'subagents: [delegate]\n'));
  write(
    join(project, '.agents', 'agents', 'delegate', 'agent.md'),
    agentMd('delegate', 'inherits: dependency-parent\n'),
  );
  write(join(project, '.agents', 'agents', 'cycle-a', 'agent.md'), agentMd('cycle-a', 'inherits: cycle-b\n'));
  write(join(project, '.agents', 'agents', 'cycle-b', 'agent.md'), agentMd('cycle-b', 'inherits: cycle-a\n'));
  write(join(project, '.agents', 'agents', 'mislabeled', 'agent.md'), agentMd('other'));
  write(
    join(project, '.agents', 'workflows', 'inheritance', 'workflow.yaml'),
    `version: 1
id: inheritance
title: Inheritance
description: Exercise an inherited workflow actor.
actors:
  child: {kind: agent, profile: child}
nodes:
  - id: run
    action: review
    description: Run the child agent.
    actor: child
`,
  );
  return resolveResources(
    discoverLayers({ homeDirectory: join(root, 'home'), projectDirectory: project, settings: {} }).layers,
  );
};

const engineerLoadout = (findings: ReturnType<typeof validateEffectiveSet>) =>
  findings.filter((f) => f.resource === 'agent:engineer' && f.message.includes("unknown skill 'from-dependency'"));

const childInheritance = (findings: ReturnType<typeof validateEffectiveSet>) =>
  findings.filter(
    (finding) => finding.resource === 'agent:child' && finding.message.includes("unknown parent 'dependency-parent'"),
  );

const leaderSubagentInheritance = (findings: ReturnType<typeof validateEffectiveSet>) =>
  findings.filter(
    (finding) =>
      finding.resource === 'agent:leader' &&
      finding.message.includes("Subagent 'delegate' is invalid: Agent inheritance references unknown parent"),
  );

const workflowActorInheritance = (findings: ReturnType<typeof validateEffectiveSet>) =>
  findings.filter(
    (finding) =>
      finding.resource === 'workflow:inheritance' &&
      finding.message.includes("node 'run' agent 'child': Agent inheritance references unknown parent"),
  );

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
});

describe('inheritance resolution deferral', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('treats an unresolved inheritance parent as an error by default (merged resolution)', () => {
    const findings = validateEffectiveSet(effectiveSet());
    expect(childInheritance(findings)).toEqual([expect.objectContaining({ severity: 'error' })]);
    expect(workflowActorInheritance(findings)).toEqual([expect.objectContaining({ severity: 'error' })]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('defers an unresolved inheritance parent while preserving structural inheritance errors', () => {
    const findings = validateEffectiveSet(effectiveSet(), undefined, { deferInheritanceResolution: true });

    expect(childInheritance(findings)).toEqual([expect.objectContaining({ severity: 'warning' })]);
    expect(leaderSubagentInheritance(findings)).toEqual([expect.objectContaining({ severity: 'warning' })]);
    expect(workflowActorInheritance(findings)).toEqual([expect.objectContaining({ severity: 'warning' })]);
    expect(
      findings.some(
        (finding) =>
          finding.resource === 'agent:cycle-a' &&
          finding.severity === 'error' &&
          finding.message.includes('inheritance cycle'),
      ),
    ).toBe(true);
  });
});
