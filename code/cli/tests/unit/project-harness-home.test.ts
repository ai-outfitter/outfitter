import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

it('forwards the selected home to Pi separately from its temporary projection', () => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-projection-home-'));
  try {
    const home = join(root, 'home');
    const projection = join(root, 'projection');
    const claudeRoot = join(root, 'claude');
    for (const path of [home, projection, claudeRoot]) mkdirSync(path);
    const plan: CompositionPlan = {
      agent: 'agent',
      identity: { agentBody: 'Body.' },
      loadout: { skills: [], delegateSkills: [], subagents: [], mcp: [], mcpServers: {}, extensions: [], plugins: [] },
      warnings: [],
    };
    const pi = projectComposition(plan, { harness: 'pi', rootDirectory: projection, homeDirectory: home });
    const claude = projectComposition(plan, { harness: 'claude', rootDirectory: claudeRoot, homeDirectory: home });
    expect(pi.launch.env?.OUTFITTER_USER_HOME).toBe(home);
    expect(pi.launch.env?.PI_CODING_AGENT_DIR).toBe(projection);
    expect(claude.launch.env?.OUTFITTER_USER_HOME).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
