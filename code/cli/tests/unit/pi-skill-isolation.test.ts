// Tests that managed Pi skill isolation preserves caller-supplied explicit skill paths.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const emptyPlan: CompositionPlan = {
  agent: 'engineer',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
  },
  warnings: [],
};

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.12).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('keeps explicit pass-through skills after disabling implicit discovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-skill-isolation-'));
  try {
    const explicitSkill = '/opt/skills/local-review';
    const projection = projectComposition(emptyPlan, {
      harness: 'pi',
      rootDirectory: root,
      homeDirectory: root,
      passThroughArgs: ['--skill', explicitSkill],
    });

    expect(projection.launch.args).toContain('--no-skills');
    expect(projection.launch.args.slice(-2)).toEqual(['--skill', explicitSkill]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
