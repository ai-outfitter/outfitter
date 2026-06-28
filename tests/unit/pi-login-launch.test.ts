// Tests pi launch-plan preparation: Outfitter header branding plus login prefill injection.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentLaunchPlan } from '../../src/agents/AgentAdapter.js';
import { preparePiLoginLaunchPlan } from '../../src/cli/commands/PiLoginLaunch.js';
import type { SetupCommandResult } from '../../src/cli/commands/SetupCommand.js';

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

type MockMessage = {
  readonly content?: string;
  readonly customType?: string;
  readonly display?: boolean;
  readonly role?: string;
};
type MockEvent = {
  readonly input?: { readonly command?: string };
  readonly messages?: readonly MockMessage[];
  readonly toolName?: string;
};
type MockContext = ReturnType<typeof createMockContext>;
type MockHandler = (event: MockEvent, context: MockContext) => unknown;
type OutfitterExtension = (pi: ReturnType<typeof createMockPi>) => void;

const createSetupResultWithWelcome = (answered: boolean): SetupCommandResult => ({
  settingsPath: '',
  defaultProfilePath: '',
  createdSettings: false,
  copiedStarterProfileFiles: 0,
  createdDefaultProfile: false,
  syncResult: { sources: [], messages: [] },
  welcomeResult: { answered, warnings: [], messages: [] },
  messages: [],
});

const evaluateOutfitterExtension = (content: string): OutfitterExtension => {
  const executableContent = content
    .replace('import { matchesKey } from "@earendil-works/pi-tui";', 'const matchesKey = (data, key) => data === key;')
    .replace('export default function outfitter', 'function outfitter');
  const sandbox = { globalThis: {} as { outfitter?: OutfitterExtension } };

  new Script(`${executableContent}\nglobalThis.outfitter = outfitter;`).runInContext(createContext(sandbox));

  if (sandbox.globalThis.outfitter === undefined) {
    throw new Error('Outfitter extension did not evaluate.');
  }

  return sandbox.globalThis.outfitter;
};

const createMockPi = () => {
  const handlers: Record<string, MockHandler[]> = {};
  let activeTools = ['read', 'bash', 'edit', 'write'];

  return {
    handlers,
    get activeTools() {
      return activeTools;
    },
    getActiveTools: () => activeTools,
    getAllTools: () => ['read', 'bash', 'grep', 'find', 'ls', 'edit', 'write'].map((name) => ({ name })),
    on: (eventName: string, handler: MockHandler) => {
      handlers[eventName] = [...(handlers[eventName] ?? []), handler];
    },
    registerCommand: () => undefined,
    setActiveTools: (toolNames: string[]) => {
      activeTools = toolNames;
    },
  };
};

const createMockContext = () => {
  let terminalInputHandler: ((data: string) => { readonly consume?: boolean } | undefined) | undefined;

  return {
    mode: 'tui',
    get terminalInputHandler() {
      return terminalInputHandler;
    },
    ui: {
      notify: () => undefined,
      onTerminalInput: (handler: (data: string) => { readonly consume?: boolean } | undefined) => {
        terminalInputHandler = handler;
        return () => undefined;
      },
      setHeader: () => undefined,
      setStatus: () => undefined,
      theme: {
        fg: (_color: string, text: string) => text,
      },
    },
  };
};

const startMockSession = async (pi: ReturnType<typeof createMockPi>, context: MockContext): Promise<void> => {
  const handler = pi.handlers.session_start?.[0];

  if (handler === undefined) {
    throw new Error('session_start handler was not registered.');
  }

  await handler({}, context);
};

const sendMockTerminalInput = (context: MockContext, data: string): { readonly consume?: boolean } | undefined => {
  if (context.terminalInputHandler === undefined) {
    throw new Error('terminal input handler was not registered.');
  }

  return context.terminalInputHandler(data);
};

const runMockBashToolCall = (pi: ReturnType<typeof createMockPi>, context: MockContext, command: string): unknown => {
  const handler = pi.handlers.tool_call?.[0];

  if (handler === undefined) {
    throw new Error('tool_call handler was not registered.');
  }

  return handler({ toolName: 'bash', input: { command } }, context);
};

const runMockContextFilter = (
  pi: ReturnType<typeof createMockPi>,
  context: MockContext,
  messages: readonly MockMessage[],
): unknown => {
  const handler = pi.handlers.context?.[0];

  if (handler === undefined) {
    throw new Error('context handler was not registered.');
  }

  return handler({ messages }, context);
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
    expect(header).toContain('ctx.getSystemPrompt()');
    expect(header).toContain('OUTFITTER_SYSTEM_PROMPT_EXPORT_PATH');
    expect(header).toContain('ctx.ui.setHeader');
    expect(header).toContain(
      'Outfitter + Pi can explain its own features and look up its docs. Ask it how to use or extend Pi or outfitter profiles.',
    );
    // Guards against running outside the interactive TUI.
    expect(header).toContain('if (ctx.mode !== "tui") return;');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('injects the Outfitter Shift+Tab mode switch for interactive pi launches', () => {
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      writeLine: () => undefined,
    });

    const extension = readExtension(plan, 'outfitter-extension.js');
    expect(extension).toContain('matchesKey(data, "shift+tab")');
    expect(extension).toContain('ctrl+shift+t thinking');
    expect(extension).toContain('pi.setActiveTools(planTools.length > 0 ? planTools : OUTFITTER_PLAN_TOOLS)');
    expect(extension).toContain('Outfitter plan mode blocks Bash commands');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('toggles plan/build mode and blocks plan-mode Bash commands', async () => {
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext();

    extension(pi);
    await startMockSession(pi, context);

    expect(sendMockTerminalInput(context, 'shift+tab')).toEqual({ consume: true });
    expect(pi.activeTools).toEqual(['read', 'grep', 'find', 'ls']);
    await expect(runMockBashToolCall(pi, context, 'rm file.txt')).resolves.toMatchObject({ block: true });
    await expect(runMockBashToolCall(pi, context, 'find . -delete')).resolves.toMatchObject({ block: true });
    await expect(runMockBashToolCall(pi, context, 'node --version && node -e "writeFile()"')).resolves.toMatchObject({
      block: true,
    });
    await expect(runMockBashToolCall(pi, context, 'ls\nnode -e "writeFile()"')).resolves.toMatchObject({
      block: true,
    });
    await expect(runMockBashToolCall(pi, context, 'ls -la')).resolves.toMatchObject({ block: true });
    await expect(
      runMockContextFilter(pi, context, [{ customType: 'outfitter-mode-context' }, { role: 'user' }]),
    ).resolves.toEqual({
      messages: [
        { role: 'user' },
        expect.objectContaining({ customType: 'outfitter-mode-context', display: false, role: 'custom' }),
      ],
    });

    expect(sendMockTerminalInput(context, 'shift+tab')).toEqual({ consume: true });
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit', 'write']);
    await expect(
      runMockContextFilter(pi, context, [{ customType: 'outfitter-mode-context' }, { role: 'user' }]),
    ).resolves.toEqual({ messages: [{ role: 'user' }] });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it.each([['--print', 'hello'], ['--mode', 'rpc'], ['--mode=json']])(
    'does not brand non-interactive pi launches: %s %s',
    (...args) => {
      const agentDir = createAgentDir();
      const messages: string[] = [];
      const plan = preparePiLoginLaunchPlan({
        adapterId: 'pi',
        homeDirectory: agentDir,
        launchPlan: createLaunchPlan(
          agentDir,
          args.filter((arg) => arg !== undefined),
        ),
        writeLine: (message) => messages.push(message),
      });

      expect(extensionPaths(plan)).toHaveLength(0);
      expect(messages).toEqual([]);
    },
  );

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps the Outfitter bootstrap for --mode without a non-interactive value', () => {
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir, ['--mode']),
      writeLine: () => undefined,
    });

    expect(() => readExtension(plan, 'outfitter-extension.js')).not.toThrow();
  });

  it('uses the default Pi config directory when PI_CODING_AGENT_DIR is absent', () => {
    const homeDirectory = createAgentDir();
    const piConfigDirectory = join(homeDirectory, '.pi', 'agent');
    mkdirSync(piConfigDirectory, { recursive: true });
    writeFileSync(join(piConfigDirectory, 'auth.json'), '{"providers":{"demo":{}}}\n');
    const messages: string[] = [];
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: { command: 'pi', args: [], env: {} },
      writeLine: (message) => messages.push(message),
    });

    expect(() => readExtension(plan, 'outfitter-extension.js')).not.toThrow();
    expect(messages).toEqual([]);
  });

  it('keeps the Outfitter bootstrap for explicit interactive mode launches', () => {
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir, ['--mode', 'text']),
      writeLine: () => undefined,
    });

    expect(() => readExtension(plan, 'outfitter-extension.js')).not.toThrow();
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('brands and auto-opens login together on first run when pi is not logged in', () => {
    const agentDir = createAgentDir();
    const messages: string[] = [];
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      setupResult: createSetupResultWithWelcome(true),
      writeLine: (message) => messages.push(message),
    });

    expect(() => readExtension(plan, 'outfitter-extension.js')).not.toThrow();
    expect(() => readExtension(plan, 'prefill-login-extension.js')).not.toThrow();
    expect(messages.some((message) => message.includes('/login'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports unreadable non-json pi login state files', () => {
    const agentDir = createAgentDir();
    mkdirSync(join(agentDir, 'models.json'));

    expect(() =>
      preparePiLoginLaunchPlan({
        adapterId: 'pi',
        homeDirectory: agentDir,
        launchPlan: createLaunchPlan(agentDir),
        writeLine: () => undefined,
      }),
    ).toThrow(`Could not read pi login state file '${join(agentDir, 'models.json')}'`);
  });

  it('brands and auto-opens /outfitter when first-run welcome is declined after login', () => {
    const agentDir = createAgentDir();
    writeFileSync(join(agentDir, 'auth.json'), '{"providers":{"demo":{}}}\n');
    const messages: string[] = [];
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      setupResult: createSetupResultWithWelcome(false),
      writeLine: (message) => messages.push(message),
    });

    expect(() => readExtension(plan, 'outfitter-extension.js')).not.toThrow();
    expect(readExtension(plan, 'prefill-outfitter-extension.js')).toContain('setEditorText("/outfitter")');
    expect(messages.some((message) => message.includes('/outfitter'))).toBe(true);
  });
});
