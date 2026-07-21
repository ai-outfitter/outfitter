// Verifies pi credentials survive Outfitter's ephemeral projection root: seeded in before launch
// and written back after, so a /login inside a session persists across runs.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  persistPiCredentials,
  resolvePiUserAgentDirectory,
  seedPiCredentials,
} from '../../src/agents/PiCredentialPersistence.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-cred-'));
  roots.push(dir);
  return dir;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('pi credential persistence', () => {
  it("resolves pi's durable agent directory under home", () => {
    expect(resolvePiUserAgentDirectory('/home/u')).toBe(join('/home/u', '.pi', 'agent'));
  });

  it('seeds existing credentials into the projection root', () => {
    const base = root();
    const userDir = join(base, 'user');
    const projection = join(base, 'projection');
    mkdirSync(projection, { recursive: true });
    write(join(userDir, 'auth.json'), '{"anthropic":"tok"}');

    seedPiCredentials(projection, userDir);
    expect(readFileSync(join(projection, 'auth.json'), 'utf8')).toBe('{"anthropic":"tok"}');
    // models.json is absent, so nothing is created for it.
    expect(existsSync(join(projection, 'models.json'))).toBe(false);
  });

  it('writes credentials created during the session back to the durable dir', () => {
    const base = root();
    const userDir = join(base, 'user');
    const projection = join(base, 'projection');
    write(join(projection, 'auth.json'), '{"anthropic":"new"}');

    persistPiCredentials(projection, userDir);
    expect(readFileSync(join(userDir, 'auth.json'), 'utf8')).toBe('{"anthropic":"new"}');
  });
});

describe('run agent credential write-back', () => {
  it('persists an auth.json a pi session writes into the projection root', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');

    // A launcher that simulates a /login by writing auth.json into pi's config dir mid-session.
    const launcher = (plan: AgentLaunchPlan): Promise<number> => {
      const agentDir = plan.env.PI_CODING_AGENT_DIR ?? '';
      writeFileSync(join(agentDir, 'auth.json'), '{"anthropic":"logged-in"}');
      return Promise.resolve(0);
    };

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher,
    });

    expect(readFileSync(join(resolvePiUserAgentDirectory(home), 'auth.json'), 'utf8')).toBe(
      '{"anthropic":"logged-in"}',
    );
  });
});
