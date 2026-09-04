// Tests that an interrupted extension installer aborts the run before any later installer or agent launch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';

const roots: string[] = [];
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;

afterEach(() => {
  if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = originalXdgCacheHome;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('run agent extension interruption', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not continue the install queue or launch pi after an interrupted extension install', async () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-run-interruption-'));
    roots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    const agentDefinition = join(project, '.agents', 'agents', 'dev', 'agent.md');
    mkdirSync(dirname(agentDefinition), { recursive: true });
    writeFileSync(agentDefinition, '---\nname: dev\nextensions: ["npm:first", "npm:never-started"]\n---\n\nBody.\n');
    process.env.XDG_CACHE_HOME = join(root, 'cache');
    const installed: string[] = [];
    let launches = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'dev',
      harness: 'pi',
      launcher: () => {
        launches += 1;
        return Promise.resolve(0);
      },
      extensionInstallSpawner: ({ source }) => {
        installed.push(source);
        return Promise.resolve(130);
      },
    });

    expect(result.exitCode).toBe(130);
    expect(result.launchPlan).toBeUndefined();
    expect(installed).toEqual(['npm:first']);
    expect(launches).toBe(0);
    expect(result.messages.join(' ')).toContain('remaining extensions and agent launch were cancelled');
  });
});
