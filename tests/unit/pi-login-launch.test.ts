// Tests pi launch-plan preparation: Outfitter header branding plus login/skill prefill injection.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentLaunchPlan } from '../../src/agents/AgentAdapter.js';
import { preparePiLoginLaunchPlan } from '../../src/cli/commands/PiLoginLaunch.js';

const temporaryRoots: string[] = [];

const createAgentDir = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-login-'));
  temporaryRoots.push(root);
  return root;
};

const createLaunchPlan = (agentDir: string, args: readonly string[] = []): AgentLaunchPlan => ({
  command: 'pi',
  args: [...args],
  env: { PI_CODING_AGENT_DIR: agentDir },
});

const extensionPaths = (plan: AgentLaunchPlan): string[] =>
  plan.args.filter((_arg, index) => plan.args[index - 1] === '--extension');

const readExtension = (plan: AgentLaunchPlan, fileName: string): string => {
  const path = extensionPaths(plan).find((candidate) => candidate.endsWith(fileName));
  if (path === undefined) {
    throw new Error(`extension ${fileName} not injected`);
  }
  return readFileSync(path, 'utf8');
};

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop() as string, { recursive: true, force: true });
  }
});

describe('preparePiLoginLaunchPlan', () => {
  it('injects the Outfitter header branding extension for interactive pi launches', () => {
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      writeLine: () => undefined,
    });

    const header = readExtension(plan, 'outfitter-extension.js');
    expect(header).toContain('ctx.ui.setHeader');
    expect(header).toContain(
      'Outfitter + Pi can explain its own features and look up its docs. Ask it how to use or extend Pi or outfitter profiles.',
    );
    // Guards against running outside the interactive TUI.
    expect(header).toContain('if (ctx.mode !== "tui") return;');
  });

  it('does not brand non-interactive pi launches', () => {
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir, ['--print', 'hello']),
      writeLine: () => undefined,
    });

    expect(extensionPaths(plan)).toHaveLength(0);
  });

  it('leaves non-pi launch plans untouched', () => {
    const agentDir = createAgentDir();
    const original = createLaunchPlan(agentDir);
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'claude',
      homeDirectory: agentDir,
      launchPlan: original,
      writeLine: () => undefined,
    });

    expect(plan).toBe(original);
  });

  it('brands and auto-opens login together on first run when pi is not logged in', () => {
    const agentDir = createAgentDir();
    const messages: string[] = [];
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      setupResult: { welcomeResult: { answered: true } } as never,
      writeLine: (message) => messages.push(message),
    });

    expect(() => readExtension(plan, 'outfitter-extension.js')).not.toThrow();
    expect(() => readExtension(plan, 'prefill-login-extension.js')).not.toThrow();
    expect(messages.some((message) => message.includes('/login'))).toBe(true);
  });
});
