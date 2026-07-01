/* eslint-disable max-lines, complexity */
// Tests pi launch-plan preparation: Outfitter bootstrap UX, native setup, and login kickoff.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Script, createContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';

import type { AgentLaunchPlan } from '../../src/agents/AgentAdapter.js';
import { preparePiLoginLaunchPlan } from '../../src/cli/commands/PiLoginLaunch.js';
import { createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];
const expectedOutfitterAsciiArt = readFileSync(
  new URL('../../src/cli/commands/assets/outfitter-ascii.txt', import.meta.url),
  'utf8',
)
  .trimEnd()
  .split('\n');

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

const writeDefaultProfilesCache = (homeDirectory: string): string => {
  const profilesPath = join(
    createRemoteRepositoryCachePath(homeDirectory, { github: 'ai-outfitter/default-profiles', path: 'profiles' }),
    'profiles',
  );

  for (const [id, label, description] of [
    ['founder', 'Founder', 'Founder/operator profile for product, planning, and execution'],
    ['engineer', 'Engineer', undefined],
    ['data_analyst', 'Data Analyst', 'Analysis profile for data questions and structured research'],
  ] as const) {
    const profileDirectory = join(profilesPath, id);
    mkdirSync(profileDirectory, { recursive: true });
    writeFileSync(
      join(profileDirectory, 'profile.yml'),
      `id: ${id}\nlabel: ${label}\n${description === undefined ? '' : `description: ${description}\n`}controls: {}\n`,
    );
  }

  return profilesPath;
};

const extensionPaths = (plan: AgentLaunchPlan): string[] =>
  plan.args.filter((_arg, index) => plan.args[index - 1] === '--extension');

const readExtension = (plan: AgentLaunchPlan, fileName: string): string => {
  const path = extensionPaths(plan).find((candidate) => candidate.endsWith(fileName));
  if (path === undefined) {
    throw new Error(`extension ${fileName} not injected`);
  }
  return readFileSync(path, 'utf8');
};

const createMockHttpsModule = (response: { readonly statusCode: number; readonly body: string }) => ({
  request(_options: unknown, callback: (value: unknown) => void) {
    return {
      on: () => undefined,
      destroy: () => undefined,
      end: () => {
        callback({
          statusCode: response.statusCode,
          setEncoding: () => undefined,
          on(eventName: string, handler: (chunk?: string) => void) {
            if (eventName === 'data') setTimeout(() => handler(response.body), 0);
            if (eventName === 'end') setTimeout(() => handler(), 0);
          },
        });
      },
    };
  },
});

const privateCatalogOnboardingModuleUrl = new URL(
  '../../../enterprise/pi-extension/privateCatalogOnboarding.js',
  import.meta.url,
).href;

type OutfitterImportGlobal = typeof globalThis & {
  __outfitterImport?: (specifier: string) => Promise<unknown>;
};

const importPrivateCatalogOnboardingModule = (
  importOverrides: Readonly<Record<string, () => Promise<unknown>>>,
): Promise<unknown> => {
  (globalThis as OutfitterImportGlobal).__outfitterImport = (specifier: string) =>
    importOverrides[specifier]?.() ?? import(specifier);
  return import(privateCatalogOnboardingModuleUrl);
};

type MockMessage = {
  readonly content?: string;
  readonly customType?: string;
  readonly display?: boolean;
  readonly role?: string;
};
type MockEvent = {
  readonly cwd?: string;
  readonly input?: { readonly command?: string };
  readonly messages?: readonly MockMessage[];
  readonly reason?: string;
  readonly toolName?: string;
};
type MockContext = ReturnType<typeof createMockContext>;
type MockHandler = (event: MockEvent, context: MockContext) => unknown;
type MockCommand = {
  readonly description?: string;
  readonly handler: (args: string, context: MockContext) => Promise<void>;
};
type OutfitterExtension = (pi: ReturnType<typeof createMockPi>) => void;

const evaluateOutfitterExtension = (
  content: string,
  importOverrides: Readonly<Record<string, () => Promise<unknown>>> = {},
): OutfitterExtension => {
  const executableContent = content
    .replace(
      'import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";',
      [
        'const Key = { up: "\\x1b[A", down: "\\x1b[B", enter: "\\r", escape: "\\x1b", ctrl: (key) => key === "c" ? "\\u0003" : "ctrl+" + key };',
        'const matchesKey = (data, key) => data === key;',
        'const visibleWidth = (text) => String(text).replace(/\\u001b\\[[0-9;]*m/gu, "").length;',
        'const truncateToWidth = (text, width) => visibleWidth(text) > width ? String(text).slice(0, Math.max(0, width - 3)) + "..." : text;',
        'const wrapTextWithAnsi = (text, width) => {',
        '  const words = String(text).split(" ");',
        '  const lines = [];',
        '  let line = "";',
        '  for (const word of words) {',
        '    const next = line ? line + " " + word : word;',
        '    if (visibleWidth(next) > width && line) { lines.push(line); line = word; }',
        '    else line = next;',
        '  }',
        '  if (line) lines.push(line);',
        '  return lines.length > 0 ? lines : [""];',
        '};',
      ].join('\n'),
    )
    .replaceAll('import("node:fs")', 'globalThis.__import("node:fs")')
    .replaceAll('import("node:path")', 'globalThis.__import("node:path")')
    .replaceAll('import("node:https")', 'globalThis.__import("node:https")')
    .replaceAll(
      'import("./pi-extension/privateCatalogOnboarding.js")',
      'globalThis.__import("./pi-extension/privateCatalogOnboarding.js")',
    )
    .replace('export default function outfitter', 'function outfitter');
  const sandbox = {
    globalThis: {
      __import: (specifier: string) =>
        specifier === './pi-extension/privateCatalogOnboarding.js'
          ? importPrivateCatalogOnboardingModule(importOverrides)
          : (importOverrides[specifier]?.() ?? import(specifier)),
    } as { __import: (specifier: string) => Promise<unknown>; outfitter?: OutfitterExtension },
    setTimeout,
  };

  new Script(`${executableContent}\nglobalThis.outfitter = outfitter;`).runInContext(createContext(sandbox));

  if (sandbox.globalThis.outfitter === undefined) {
    throw new Error('Outfitter extension did not evaluate.');
  }

  return sandbox.globalThis.outfitter;
};

const createMockPi = () => {
  const commands: Record<string, MockCommand> = {};
  const handlers: Record<string, MockHandler[]> = {};
  let activeTools = ['read', 'bash', 'edit', 'write'];

  return {
    commands,
    handlers,
    get activeTools() {
      return activeTools;
    },
    getActiveTools: () => activeTools,
    getAllTools: () => ['read', 'bash', 'grep', 'find', 'ls', 'edit', 'write'].map((name) => ({ name })),
    on: (eventName: string, handler: MockHandler) => {
      handlers[eventName] = [...(handlers[eventName] ?? []), handler];
    },
    registerCommand: (name: string, command: MockCommand) => {
      commands[name] = command;
    },
    setActiveTools: (toolNames: string[]) => {
      activeTools = toolNames;
    },
  };
};

const createMockContext = (
  options: {
    readonly availableModels?: readonly unknown[];
    readonly inputValues?: readonly string[];
    readonly selectedOption?: string;
    readonly selectedOptions?: readonly (string | undefined)[];
  } = {},
) => {
  let editorText = '';
  let terminalInputHandler: ((data: string) => { readonly consume?: boolean } | undefined) | undefined;
  const notifications: string[] = [];
  const selectCalls: Array<{ readonly title: string; readonly options: readonly string[] }> = [];
  const inputCalls: Array<{ readonly message: string; readonly defaultValue?: string }> = [];
  const headerRenders: string[][] = [];
  const customRenders: string[][] = [];
  const submittedInputs: string[] = [];
  const selectedOptions = [...(options.selectedOptions ?? [])];
  const inputValues = [...(options.inputValues ?? [])];
  const nextSelectedOption = (fallback: string): string | undefined =>
    selectedOptions.length > 0 ? selectedOptions.shift() : (options.selectedOption ?? fallback);

  return {
    hasUI: true,
    mode: 'tui',
    modelRegistry: {
      getAvailable: () => Promise.resolve(options.availableModels ?? [{}]),
    },
    get editorText() {
      return editorText;
    },
    notifications,
    headerRenders,
    customRenders,
    inputCalls,
    selectCalls,
    submittedInputs,
    get terminalInputHandler() {
      return terminalInputHandler;
    },
    ui: {
      custom: <T>(
        factory: (
          tui: { focusedComponent?: { handleInput(input: string): void }; requestRender?: () => void },
          theme: { bold(text: string): string; fg(_color: string, text: string): string },
          keybindings: unknown,
          done: (result: T) => void,
        ) => unknown,
      ) =>
        new Promise<T>((resolve) => {
          const theme = {
            bold: (text: string) => text,
            fg: (_color: string, text: string) => text,
          };
          const component = factory(
            {
              focusedComponent: {
                handleInput(input: string) {
                  submittedInputs.push(input);
                },
              },
              requestRender: () => undefined,
            },
            theme,
            {},
            resolve,
          );
          if (
            component !== null &&
            typeof component === 'object' &&
            'outfitterOptions' in component &&
            'handleInput' in component
          ) {
            const selector = component as {
              outfitterOptions: readonly string[];
              handleInput(input: string): void;
              render?(width?: number): string[];
            };
            customRenders.push(selector.render?.(117) ?? []);
            const selected = nextSelectedOption(selector.outfitterOptions[0] ?? '');
            if (selected === undefined) {
              selector.handleInput('\x1b');
              return;
            }
            const selectedIndex = Math.max(0, selector.outfitterOptions.indexOf(selected));
            for (let index = 0; index < selectedIndex; index += 1) selector.handleInput('\x1b[B');
            customRenders.push(selector.render?.(117) ?? []);
            selector.handleInput('\r');
          }
        }),
      input: (message: string, inputOptions?: { readonly defaultValue?: string }) => {
        inputCalls.push({ message, defaultValue: inputOptions?.defaultValue });
        return Promise.resolve(inputValues.shift() ?? inputOptions?.defaultValue ?? '');
      },
      notify: (message: string) => {
        notifications.push(message);
      },
      onTerminalInput: (handler: (data: string) => { readonly consume?: boolean } | undefined) => {
        terminalInputHandler = handler;
        return () => undefined;
      },
      select: (title: string, selectOptions: readonly string[]) => {
        selectCalls.push({ title, options: selectOptions });
        return Promise.resolve(nextSelectedOption(selectOptions[0] ?? ''));
      },
      setEditorText: (text: string) => {
        editorText = text;
      },
      setHeader: (
        factory: (
          _tui: unknown,
          theme: { bold(text: string): string; fg(_color: string, text: string): string },
        ) => { render(): string[] },
      ) => {
        headerRenders.push(
          factory(
            {},
            {
              bold: (text: string) => text,
              fg: (_color: string, text: string) => text,
            },
          ).render(),
        );
      },
      setStatus: () => undefined,
      theme: {
        bold: (text: string) => text,
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

  await handler({ reason: 'startup' }, context);
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

const runMockProjectTrust = (pi: ReturnType<typeof createMockPi>, context: MockContext, cwd: string): unknown => {
  const handler = pi.handlers.project_trust?.[0];

  if (handler === undefined) {
    throw new Error('project_trust handler was not registered.');
  }

  return handler({ cwd }, context);
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

const runOutfitterCommand = async (pi: ReturnType<typeof createMockPi>, context: MockContext): Promise<void> => {
  const command = pi.commands.outfitter;

  if (command === undefined) {
    throw new Error('outfitter command was not registered.');
  }

  await command.handler('', context);
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
    expect(header).toContain('pi.registerCommand("outfitter"');
    expect(header).toContain('ctx.ui.setHeader');
    expect(header).toContain(
      'Outfitter + Pi can explain its own features and look up its docs. Ask it how to use or extend Pi or outfitter profiles.',
    );
    // Guards against running outside the interactive TUI.
    expect(header).toContain('if (ctx.mode !== "tui") return;');
    expect(header).not.toContain('pi.sendUserMessage');
  });

  it('renders the Outfitter ASCII startup art by default', async () => {
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

    expect(readExtension(plan, 'outfitter-extension.js')).toContain(
      'const OUTFITTER_ASCII_GRADIENT = ["success", "accent", "text", "muted", "dim"]',
    );
    expect(context.headerRenders[0]?.slice(0, 5)).toEqual(expectedOutfitterAsciiArt);
  });

  it('renders first-run explanatory startup text and allows startup ASCII art to be disabled', async () => {
    const homeDirectory = createAgentDir();
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { autoOpenOutfitter: true },
      startupAsciiArt: false,
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext();

    extension(pi);
    await startMockSession(pi, context);

    const header = context.headerRenders[0]?.join('\n') ?? '';
    expect(header).toContain('Outfitter turns Pi into a configured working environment:');
    expect(header).toContain('profiles define model, tools, prompts, skills, and extensions');
    expect(header).not.toContain('/outfitter will help you choose a profile catalog and install location.');
    expect(header).not.toContain('____');
    expect(context.notifications.join('\n')).not.toContain('/outfitter');
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
  it('opens Pi login from the bootstrap extension when runtime models are unavailable', async () => {
    const agentDir = createAgentDir();
    const messages: string[] = [];
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      writeLine: (message) => messages.push(message),
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext({ availableModels: [] });

    extension(pi);
    await startMockSession(pi, context);

    expect(context.editorText).toBe('/login');
    expect(context.submittedInputs).toEqual(['\r']);
    expect(context.notifications.join('\n')).not.toContain('Pi does not have a model provider connected yet');
    expect(context.customRenders[0]?.join('\n')).toContain('Pi does not have a model provider connected yet.');
    expect(context.customRenders[0]?.join('\n')).toContain('Connect one now so Outfitter can use Pi.');
    expect(context.customRenders[0]?.join('\n')).toContain('Credentials stay inside Pi.');
    expect(context.customRenders[0]?.join('\n')).toContain('→ Connect a model provider');
    expect(messages).toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1, OFTR-010.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('registers native /outfitter and persists the selected default profile without an agent turn', async () => {
    const homeDirectory = createAgentDir();
    const agentDir = createAgentDir();
    const defaultProfilesPath = writeDefaultProfilesCache(homeDirectory);
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { defaultProfilesPath },
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext({
      selectedOptions: [
        'Use the default Outfitter profile catalog',
        'data_analyst — Data Analyst',
        'Home folder (~/.outfitter)',
      ],
    });

    extension(pi);
    await runOutfitterCommand(pi, context);

    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    expect(Object.keys(pi.commands)).toContain('outfitter');
    expect(context.selectCalls[0]).toEqual({
      title: 'How would you like to set up Outfitter?',
      options: [
        'Use the default Outfitter profile catalog',
        'Create your own profile',
        'Provide a different catalog to import',
      ],
    });
    expect(context.customRenders[0]?.join('\n')).not.toContain('• founder');
    expect(context.customRenders[0]?.join('\n')).toContain('founder — Founder (Recommended)');
    expect(context.customRenders[0]?.join('\n')).toContain(
      'Founder/operator profile for product, planning, and execution',
    );
    expect(context.customRenders[1]?.join('\n')).toMatch(
      /data_analyst — Data Analyst\s+Analysis profile for data questions and structured research/u,
    );
    expect(context.customRenders[1]?.find((line) => line.includes('engineer — Engineer'))?.trimEnd()).toBe(
      '  engineer — Engineer',
    );
    expect(context.customRenders[2]?.[0]).toMatch(/^─+$/u);
    expect(context.customRenders[2]?.at(-1)).toMatch(/^─+$/u);
    expect(context.customRenders[2]?.join('\n')).toContain('Where should Outfitter install these settings?');
    expect(context.customRenders[2]?.join('\n')).toContain('→ Home folder (~/.outfitter)');
    expect(context.customRenders[2]?.join('\n')).toContain(
      'These profiles will be available anywhere you start outfitter.',
    );
    expect(readFileSync(settingsPath, 'utf8')).toBe(
      [
        'default_profile: data_analyst',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );
    expect(existsSync(join(homeDirectory, '.outfitter', 'profiles'))).toBe(true);
    expect(context.notifications.join('\n')).toContain("applies on the next 'outfitter' launch");
  });

  it('defaults the profile picker to founder when founder is available', async () => {
    const homeDirectory = createAgentDir();
    const agentDir = createAgentDir();
    const defaultProfilesPath = writeDefaultProfilesCache(homeDirectory);
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { defaultProfilesPath },
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext({
      selectedOptions: [
        'Use the default Outfitter profile catalog',
        'founder — Founder (Recommended)',
        'Home folder (~/.outfitter)',
      ],
    });

    extension(pi);
    await runOutfitterCommand(pi, context);

    expect(context.customRenders[0]?.join('\n')).toContain('→ founder — Founder (Recommended)');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: founder',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not overwrite an existing user profile when creating an explicit custom profile', async () => {
    const homeDirectory = createAgentDir();
    const agentDir = createAgentDir();
    const existingProfilePath = join(homeDirectory, '.outfitter', 'profiles', 'founder', 'profile.yml');
    const existingProfileContent = 'id: founder\nlabel: User-owned file\ncontrols: {}\n';
    mkdirSync(join(homeDirectory, '.outfitter', 'profiles', 'founder'), { recursive: true });
    writeFileSync(existingProfilePath, existingProfileContent);
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: {},
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext({
      inputValues: ['founder', 'Founder'],
      selectedOptions: ['Create your own profile', 'Home folder (~/.outfitter)'],
    });

    extension(pi);
    await runOutfitterCommand(pi, context);

    expect(readFileSync(existingProfilePath, 'utf8')).toBe(existingProfileContent);
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: founder',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists an imported catalog as remote_settings in the selected project directory', async () => {
    const homeDirectory = createAgentDir();
    const projectDirectory = createAgentDir();
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { projectDirectory },
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext({
      inputValues: ['my_account/outfitter_config', 'main', 'settings.yml'],
      selectedOptions: ['Provide a different catalog to import', 'Current project directory (.outfitter)'],
    });

    extension(pi);
    await runOutfitterCommand(pi, context);

    expect(readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe(
      [
        'remote_settings:',
        '  - github: my_account/outfitter_config',
        '    ref: main',
        '    path: settings.yml',
        '',
      ].join('\n'),
    );
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
    expect(context.customRenders[1]?.join('\n')).toContain('→ Current project directory (.outfitter)');
    expect(context.customRenders[1]?.join('\n')).toContain(
      'These profiles will only be available in the current project directory and',
    );
    expect(context.customRenders[1]?.join('\n')).toContain(
      'will compose the profiles of the same name in the home folder.',
    );
    expect(context.customRenders[1]?.every((line) => line.length <= 117)).toBe(true);
  });

  it('asks before importing a confirmed-private GitHub catalog and writes the home enterprise setting', async () => {
    const homeDirectory = createAgentDir();
    const projectDirectory = createAgentDir();
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { projectDirectory },
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'), {
      'node:https': () => Promise.resolve(createMockHttpsModule({ statusCode: 200, body: '{"private":true}' })),
    });
    const pi = createMockPi();
    const context = createMockContext({
      inputValues: ['company/private-profiles', 'main', 'settings.yml'],
      selectedOptions: [
        'Provide a different catalog to import',
        'Enable and continue',
        'Current project directory (.outfitter)',
      ],
    });

    extension(pi);
    await runOutfitterCommand(pi, context);

    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'private_profile_catalogs: true',
    );
    expect(readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'github: company/private-profiles',
    );
    expect(context.notifications).toContain(
      'Outfitter enabled private profile catalogs in ~/.outfitter/settings.yml and saved this catalog.',
    );
    expect(context.customRenders.flat().join('\n')).toContain(
      'Enable private profile catalogs in ~/.outfitter/settings.yml and use this catalog?',
    );
  });

  it('leaves settings unchanged when private catalog install target selection is cancelled', async () => {
    const homeDirectory = createAgentDir();
    const projectDirectory = createAgentDir();
    const agentDir = createAgentDir();
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { projectDirectory },
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'), {
      'node:https': () => Promise.resolve(createMockHttpsModule({ statusCode: 200, body: '{"private":true}' })),
    });
    const pi = createMockPi();
    const context = createMockContext({
      inputValues: ['company/private-profiles', 'main', 'settings.yml'],
      selectedOptions: ['Provide a different catalog to import', 'Enable and continue', undefined],
    });

    extension(pi);
    await runOutfitterCommand(pi, context);

    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
    expect(existsSync(join(projectDirectory, '.outfitter', 'settings.yml'))).toBe(false);
    expect(context.notifications).toContain('Outfitter setup cancelled; no settings were changed.');
  });

  it('skips the private-catalog prompt when the home enterprise setting is already enabled', async () => {
    const homeDirectory = createAgentDir();
    const projectDirectory = createAgentDir();
    const agentDir = createAgentDir();
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'enterprise:\n  private_profile_catalogs: true\n');
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { projectDirectory },
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext({
      inputValues: ['company/private-profiles', 'main', 'settings.yml'],
      selectedOptions: ['Provide a different catalog to import', 'Current project directory (.outfitter)'],
    });

    extension(pi);
    await runOutfitterCommand(pi, context);

    expect(readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'github: company/private-profiles',
    );
    expect(context.customRenders.flat().join('\n')).not.toContain('Enable private profile catalogs');
  });

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

  it('auto-trusts the exact project folder during first-run runtime onboarding', async () => {
    const agentDir = createAgentDir();
    const projectDirectory = join(agentDir, 'project');
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { autoOpenOutfitter: true, projectDirectory },
      writeLine: () => undefined,
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext();

    extension(pi);

    await expect(runMockProjectTrust(pi, context, resolve(projectDirectory))).resolves.toEqual({
      trusted: 'yes',
      remember: true,
    });
    await expect(runMockProjectTrust(pi, context, dirname(projectDirectory))).resolves.toEqual({
      trusted: 'undecided',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('auto-opens native /outfitter during first-run runtime onboarding', async () => {
    const agentDir = createAgentDir();
    writeFileSync(join(agentDir, 'auth.json'), '{"providers":{"demo":{}}}\n');
    const messages: string[] = [];
    const plan = preparePiLoginLaunchPlan({
      adapterId: 'pi',
      homeDirectory: agentDir,
      launchPlan: createLaunchPlan(agentDir),
      runtimeOnboarding: { autoOpenOutfitter: true, defaultProfilesPath: writeDefaultProfilesCache(agentDir) },
      writeLine: (message) => messages.push(message),
    });
    const extension = evaluateOutfitterExtension(readExtension(plan, 'outfitter-extension.js'));
    const pi = createMockPi();
    const context = createMockContext();

    extension(pi);
    await startMockSession(pi, context);

    expect(context.editorText).toBe('/outfitter');
    expect(context.submittedInputs).toEqual(['\r']);
    expect(messages.some((message) => message.includes('/outfitter'))).toBe(false);
    expect(readFileSync(join(agentDir, 'settings.json'), 'utf8')).toContain('"quietStartup": true');
    expect(plan.args).toEqual(['--extension', expect.stringContaining('outfitter-extension.js')]);
    expect(plan.args).not.toContain('--model');
  });
});
