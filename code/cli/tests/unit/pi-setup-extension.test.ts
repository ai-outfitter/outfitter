// Exercises the generated Pi `/outfitter` UI, including the provider step that follows the
// walkthrough: the setup shell offers Pi's native /login when no real provider is connected.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiSetupExtensionContent } from '../../src/cli/commands/SetupCommand.js';
import type { SetupAgentChoice } from '../../src/setup/Setup.js';

const roots: string[] = [];
const choices: readonly SetupAgentChoice[] = [
  { id: 'engineer', label: 'Engineer', description: 'Engineering profile.' },
  {
    id: 'founder',
    label: 'Founder',
    description: 'Founder/operator profile for product, planning, and execution.',
  },
];

type MockContext = ReturnType<typeof createMockContext>;
type Handler = (event: Record<string, unknown>, context: MockContext) => Promise<unknown>;

const evaluateExtension = (
  content: string,
  repositoryVisibility: 'private' | 'public' = 'public',
): ((pi: ReturnType<typeof createMockPi>) => void) => {
  // The login-wait poll sleeps 150 ms per tick in pi; compress it so the tests stay fast.
  const fastTimeout = (callback: () => void, delay?: number): ReturnType<typeof setTimeout> =>
    setTimeout(callback, Math.min(delay ?? 0, 2));
  const executable = content
    .replace(
      /import \{ Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi \} from ['"]@earendil-works\/pi-tui['"];/u,
      [
        'const Key = { up: "UP", down: "DOWN", enter: "ENTER", escape: "ESC", ctrl: (key) => "CTRL-" + key };',
        'const matchesKey = (data, key) => data === key;',
        'const visibleWidth = (text) => String(text).length;',
        'const truncateToWidth = (text, width) => String(text).slice(0, width);',
        'const wrapTextWithAnsi = (text, width) => {',
        '  const words = String(text).split(" "); const lines = []; let line = "";',
        '  for (const word of words) { const next = line ? line + " " + word : word;',
        '    if (next.length > width && line) { lines.push(line); line = word; } else line = next; }',
        '  if (line) lines.push(line); return lines.length ? lines : [""];',
        '};',
      ].join('\n'),
    )
    .replace(/import\(['"]node:fs['"]\)/gu, 'globalThis.__import("node:fs")')
    .replace(/import\(['"]node:path['"]\)/gu, 'globalThis.__import("node:path")')
    .replace(
      /import\(['"]\.\/pi-extension\/privateCatalogOnboarding\.js['"]\)/gu,
      'globalThis.__import("./pi-extension/privateCatalogOnboarding.js")',
    )
    .replace('export default function outfitter', 'function outfitter');
  const sandbox = {
    globalThis: {
      __import: (specifier: string): Promise<unknown> =>
        specifier === './pi-extension/privateCatalogOnboarding.js'
          ? Promise.resolve({
              classifyGitHubRepositoryVisibility: () => Promise.resolve(repositoryVisibility),
              confirmPrivateCatalog: (
                ctx: MockContext,
                select: (
                  context: MockContext,
                  title: readonly string[],
                  items: readonly { value: string; label: string; description: string }[],
                  initial: string,
                ) => Promise<string | undefined>,
                repository: string,
              ) =>
                select(
                  ctx,
                  [`Private GitHub profile catalog detected: ${repository}.`],
                  [
                    { value: 'enable', label: 'Enable and continue', description: 'Enable private profile catalogs.' },
                    {
                      value: 'cancel',
                      label: 'Cancel private catalog setup',
                      description: 'Leave settings unchanged.',
                    },
                  ],
                  'enable',
                ).then((selected) => selected === 'enable'),
              readPrivateProfileCatalogsEnabled: () => false,
            })
          : import(specifier),
      outfitter: undefined as ((pi: ReturnType<typeof createMockPi>) => void) | undefined,
    },
    setTimeout: fastTimeout,
  };
  new Script(`${executable}\nglobalThis.outfitter = outfitter;`).runInContext(createContext(sandbox));
  if (sandbox.globalThis.outfitter === undefined) throw new Error('extension did not evaluate');
  return sandbox.globalThis.outfitter;
};

const createMockPi = () => {
  const commands: Record<string, { handler: Handler }> = {};
  const handlers: Record<string, Handler[]> = {};
  let activeTools = ['read', 'bash', 'edit', 'write'];
  return {
    commands,
    handlers,
    getActiveTools: () => activeTools,
    getAllTools: () => ['read', 'bash', 'grep', 'find', 'ls', 'edit', 'write'].map((name) => ({ name })),
    setActiveTools(tools: string[]) {
      activeTools = tools;
    },
    registerCommand(name: string, command: { handler: Handler }) {
      commands[name] = command;
    },
    on(name: string, handler: Handler) {
      handlers[name] = [...(handlers[name] ?? []), handler];
    },
  };
};

// Drives a rendered described-option picker: navigates to `targetIndex` (or the preselected default
// when undefined) and confirms; -1 presses Escape. Reaching index 0 first (moves clamp) makes the
// landing deterministic.
const driveDescribedOption = (
  component: { handleInput?: (key: string) => void },
  targetIndex: number | undefined,
): void => {
  if (targetIndex === -1) {
    component.handleInput?.('ESC');
    return;
  }
  if (targetIndex !== undefined) {
    for (let step = 0; step < 20; step += 1) component.handleInput?.('UP');
    for (let step = 0; step < targetIndex; step += 1) component.handleInput?.('DOWN');
  }
  component.handleInput?.('ENTER');
};

const createMockContext = (
  options: {
    mode?: string;
    inputs?: readonly string[];
    // Chooses a described-option index by its labels; undefined keeps the preselected default.
    pickOption?: (labels: readonly string[]) => number | undefined;
    // Models pi reports before /login; a real provider is available by default so the walkthrough
    // tests end without the provider step.
    models?: readonly { provider: string }[];
    // What /login does in this mock: connect a provider, get cancelled from pi's login UI, or never
    // open the login UI at all.
    login?: 'connect' | 'connect-late' | 'cancel' | 'never-opens' | 'no-editor';
    modelRegistry?: false;
  } = {},
) => {
  const rendered: string[][] = [];
  const notifications: string[] = [];
  const selectCalls: Array<{ title: string; options: readonly string[] }> = [];
  const inputs = [...(options.inputs ?? [])];
  let models = [...(options.models ?? [{ provider: 'anthropic' }])];
  let loginSubmitted = false;
  let editorText = '';
  // pi's editor: Enter on '/login' opens the login UI; in this mock that also plays out the
  // configured outcome, since pi refreshes its registry right after saving credentials.
  const editor = {
    handleInput: (key: string) => {
      if (key !== '\r' || editorText !== '/login') return;
      loginSubmitted = true;
      if ((options.login ?? 'connect') === 'connect') models = [...models, { provider: 'anthropic' }];
    },
  };
  const loginOpensUi = options.login === 'cancel' || options.login === 'connect-late';
  const loginUi = { handleInput: () => undefined };
  let loginUiTicks = 0;
  let shutdowns = 0;
  return {
    hasUI: true,
    mode: 'tui',
    ...(options.modelRegistry === false ? {} : { modelRegistry: { getAvailable: () => [...models] } }),
    rendered,
    notifications,
    selectCalls,
    get editorText() {
      return editorText;
    },
    get shutdowns() {
      return shutdowns;
    },
    shutdown() {
      shutdowns += 1;
    },
    ui: {
      custom<T>(factory: (...args: unknown[]) => unknown): Promise<T> {
        return new Promise<T>((resolve) => {
          const tui = {
            requestRender: () => undefined,
            // After /login is submitted, pi focuses its login UI; a cancelled login hands focus
            // back to the editor two polls later.
            get focusedComponent() {
              if (options.login === 'no-editor') return null;
              if (!loginSubmitted || !loginOpensUi) return editor;
              loginUiTicks += 1;
              // pi saves the credential (registry refreshes) before handing focus back to the editor.
              if (options.login === 'connect-late' && loginUiTicks === 2)
                models = [...models, { provider: 'anthropic' }];
              return loginUiTicks <= 2 ? loginUi : editor;
            },
          };
          const component = factory(
            tui,
            { fg: (_color: string, text: string) => text, bold: (text: string) => text },
            {},
            resolve,
          ) as {
            outfitterOptions?: readonly string[];
            render?: (width: number) => string[];
            handleInput?: (key: string) => void;
          };
          if (component.outfitterOptions !== undefined) {
            rendered.push(component.render?.(40) ?? []);
            driveDescribedOption(component, options.pickOption?.(component.outfitterOptions));
          }
        });
      },
      input: () => Promise.resolve(inputs.shift()),
      notify(message: string) {
        notifications.push(message);
      },
      select(title: string, selectOptions: readonly string[]) {
        selectCalls.push({ title, options: selectOptions });
        if (options.mode === 'cancel') return Promise.resolve(undefined);
        const wanted =
          options.mode === 'create'
            ? 'Create your own profile'
            : options.mode === 'catalog'
              ? 'Provide a different catalog to import'
              : selectOptions[0];
        return Promise.resolve(wanted);
      },
      setEditorText(value: string) {
        editorText = value;
      },
      setHeader(factory: (...args: unknown[]) => unknown) {
        const component = factory({}, { fg: (_color: string, text: string) => text, bold: (text: string) => text }) as {
          render(width: number): string[];
        };
        rendered.push(component.render(40));
      },
      setStatus: () => undefined,
      onTerminalInput: () => undefined,
      theme: { fg: (_color: string, text: string) => text },
    },
  };
};

const fixture = (options: { setupSourceUri?: string; visibility?: 'private' | 'public' } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-extension-'));
  roots.push(root);
  const resultPath = join(root, 'selection.json');
  const home = join(root, 'home');
  const project = join(root, 'project');
  const extension = evaluateExtension(
    createPiSetupExtensionContent({
      homeDirectory: home,
      projectDirectory: project,
      resultPath,
      availableAgents: choices,
      setupSourceUri: options.setupSourceUri,
    }),
    options.visibility,
  );
  const pi = createMockPi();
  extension(pi);
  return { pi, resultPath, home, project };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Pi setup extension', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('restores the original questions and mentions the telemetry setting on completion', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext();
    await pi.commands.outfitter.handler({}, context);

    expect(context.selectCalls[0]).toEqual({
      title: 'How would you like to set up Outfitter?',
      options: [
        'Use the default Outfitter profile catalog',
        'Create your own profile',
        'Provide a different catalog to import',
      ],
    });
    expect(context.rendered[0]?.join('\n')).toContain('Outfitter profile setup');
    expect(context.rendered[0]?.join('\n')).toContain('→ engineer — Engineer (Recommended)');
    expect(context.rendered[1]?.join(' ')).toContain('Where should Outfitter install these settings?');
    expect(context.rendered[2]?.join(' ')).toContain('Which CLI agent should Outfitter use by default?');
    expect(context.rendered[2]?.join('\n')).toContain('→ Pi / Outfitter (Recommended)');
    expect(context.rendered[2]?.join('\n')).toContain('Codex CLI');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'default',
      agentId: 'engineer',
      harness: 'pi',
      target: 'home',
    });
    expect(context.rendered.flat().every((line) => line.length <= 40)).toBe(true);
    expect(context.notifications.join('\n')).toContain(
      'Pseudonymous usage analytics are on by default; turn them off with telemetry.enabled: false',
    );
    expect(context.shutdowns).toBe(1);
  });

  it('keeps the original create-your-own-profile prompts and ordering', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ mode: 'create', inputs: ['my_profile', 'My Profile'] });
    await pi.commands.outfitter.handler({}, context);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'create',
      agentId: 'my-profile',
      agentLabel: 'My Profile',
      harness: 'pi',
      target: 'home',
    });
  });

  it('keeps the original different-catalog prompts and ordering', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['my_account/outfitter_config', 'main', 'settings.yml'],
    });
    await pi.commands.outfitter.handler({}, context);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'catalog',
      github: 'my_account/outfitter_config',
      ref: 'main',
      settingsPath: 'settings.yml',
      harness: 'pi',
      target: 'home',
    });
  });

  const seedSettings = (home: string): void => {
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, '.agents', 'settings.yml'), 'default_agent: keepme\n');
  };

  it('does not replace existing settings when the user declines the confirmation', async () => {
    const { pi, resultPath, home } = fixture();
    seedSettings(home);
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['my_account/outfitter_config', 'main', 'settings.yml'],
      // Default preselection is "Keep my current settings"; the default mock presses it.
    });
    await pi.commands.outfitter.handler({}, context);

    expect(existsSync(resultPath)).toBe(false);
    expect(readFileSync(join(home, '.agents', 'settings.yml'), 'utf8')).toBe('default_agent: keepme\n');
    expect(context.notifications.some((message) => message.includes('Kept your existing'))).toBe(true);
    expect(context.shutdowns).toBe(1);
  });

  it('replaces existing settings only after the user confirms', async () => {
    const { pi, resultPath, home } = fixture();
    seedSettings(home);
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['my_account/outfitter_config', 'main', 'settings.yml'],
      pickOption: (labels) => {
        const index = labels.findIndex((label) => label.includes('Replace them'));
        return index === -1 ? undefined : index;
      },
    });
    await pi.commands.outfitter.handler({}, context);

    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      setupMode: 'catalog',
      github: 'my_account/outfitter_config',
      target: 'home',
    });
  });

  it('keeps the original private-catalog confirmation before target selection', async () => {
    const { pi, resultPath } = fixture({ visibility: 'private' });
    const context = createMockContext({
      mode: 'catalog',
      inputs: ['company/private-profiles', 'main', 'settings.yml'],
    });
    await pi.commands.outfitter.handler({}, context);
    expect(context.rendered.flat().join(' ')).toContain(
      'Private GitHub profile catalog detected: company/private-profiles.',
    );
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({
      setupMode: 'catalog',
      privateCatalogAccepted: true,
      privateCatalogsEnabled: true,
    });
  });

  it('bypasses the setup-mode question for a provided source, as the original flow did', async () => {
    const { pi, resultPath } = fixture({ setupSourceUri: 'https://example.test/catalog.git' });
    const context = createMockContext();
    await pi.commands.outfitter.handler({}, context);
    expect(context.selectCalls).toEqual([]);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'source',
      sourceUri: 'https://example.test/catalog.git',
      harness: 'pi',
      target: 'home',
    });
  });

  it('cancels without writing a handoff', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ mode: 'cancel' });
    await pi.commands.outfitter.handler({}, context);
    expect(existsSync(resultPath)).toBe(false);
    expect(context.notifications.join('\n')).toContain('no settings were changed');
    expect(context.shutdowns).toBe(1);
  });

  it('brands startup with the original header and auto-opens /outfitter without model login', async () => {
    const { pi } = fixture();
    const context = createMockContext();
    await pi.handlers.session_start[0]({ reason: 'startup' }, context);
    expect(context.editorText).toBe('/outfitter');
    expect(context.rendered.flat().join('\n')).toContain('Outfitter + pi');
    expect(context.rendered.flat().join('\n')).toContain('profiles define model, tools, prompts,');
  });

  it('omits the arrow-key legend for a single-item picker but keeps it for longer lists', async () => {
    const { pi } = fixture();
    const context = createMockContext({ models: [], login: 'connect' });
    await pi.commands.outfitter.handler({}, context);
    const profilePicker = context.rendered[0]?.join('\n') ?? '';
    const providerDialog = context.rendered[3]?.join('\n') ?? '';
    expect(profilePicker).toContain('↑↓ navigate  enter select');
    expect(providerDialog).toContain('enter connect  escape skip');
    expect(providerDialog).not.toContain('navigate');
  });

  it('does not tell the user to restart Outfitter after setup', async () => {
    const { pi } = fixture();
    const context = createMockContext();
    await pi.commands.outfitter.handler({}, context);
    expect(context.notifications.join('\n')).not.toMatch(/restart/iu);
    expect(context.notifications.join('\n')).toContain('Pseudonymous usage analytics');
  });
});

// THESE TESTS VALIDATE A HARD REQUIREMENT (OFTR-010.7).
describe('Pi setup extension provider step', () => {
  const fullWidth = (context: MockContext): string => context.rendered.flat().join(' ');

  it('offers /login after the handoff when no real provider is connected and waits for it', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ models: [{ provider: 'outfitter-setup' }], login: 'connect' });
    await pi.commands.outfitter.handler({}, context);

    // The handoff precedes the provider step, and the dialog follows the CLI-agent screen.
    expect(fullWidth(context)).toContain('Pi does not have a model provider connected yet.');
    expect(fullWidth(context)).toContain('Press Enter to open /login');
    expect(context.rendered[3]?.join(' ')).toContain('Connect a model provider');
    expect(context.editorText).toBe('/login');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toEqual({
      setupMode: 'default',
      agentId: 'engineer',
      harness: 'pi',
      target: 'home',
    });
    expect(context.shutdowns).toBe(1);
  });

  it('skips the provider step when a real provider is already connected', async () => {
    const { pi } = fixture();
    const context = createMockContext({ models: [{ provider: 'outfitter-setup' }, { provider: 'openai' }] });
    await pi.commands.outfitter.handler({}, context);
    expect(fullWidth(context)).not.toContain('model provider');
    expect(context.editorText).toBe('');
  });

  it('skips the provider step for a non-Pi harness', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({
      models: [],
      pickOption: (labels) => {
        const index = labels.findIndex((label) => label.includes('Claude Code'));
        return index === -1 ? undefined : index;
      },
    });
    await pi.commands.outfitter.handler({}, context);
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ harness: 'claude' });
    expect(fullWidth(context)).not.toContain('model provider');
  });

  it('records a skipped provider step in the handoff when the user presses Escape', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({
      models: [],
      pickOption: (labels) => (labels.includes('Connect a model provider') ? -1 : undefined),
    });
    // -1 makes the driver press Escape via its target-index guard below.
    await pi.commands.outfitter.handler({}, context);
    expect(context.editorText).toBe('');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });
    expect(context.shutdowns).toBe(1);
  });

  it('records a skipped provider step when the user leaves pi login without connecting', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ models: [], login: 'cancel' });
    await pi.commands.outfitter.handler({}, context);
    expect(context.editorText).toBe('/login');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });
    expect(context.shutdowns).toBe(1);
  });

  it('reports connected when the credential lands after pi showed its login UI', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ models: [], login: 'connect-late' });
    await pi.commands.outfitter.handler({}, context);
    expect(context.editorText).toBe('/login');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).not.toHaveProperty('providerConnection');
    expect(context.shutdowns).toBe(1);
  });

  it('gives up waiting when pi never opens its login UI or has no editor to submit it', async () => {
    for (const login of ['never-opens', 'no-editor'] as const) {
      const { pi, resultPath } = fixture();
      const context = createMockContext({ models: [], login });
      await pi.commands.outfitter.handler({}, context);
      expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });
    }
  });

  it('treats a missing or failing model registry as no provider', async () => {
    const { pi, resultPath } = fixture();
    const context = createMockContext({ modelRegistry: false, login: 'never-opens' });
    await pi.commands.outfitter.handler({}, context);
    expect(fullWidth(context)).toContain('Pi does not have a model provider connected yet.');
    expect(JSON.parse(readFileSync(resultPath, 'utf8'))).toMatchObject({ providerConnection: 'skipped' });

    const failing = fixture();
    const failingContext = createMockContext({ login: 'connect' });
    let calls = 0;
    Object.assign(failingContext, {
      modelRegistry: {
        getAvailable: () => {
          calls += 1;
          if (calls === 1) throw new Error('registry unavailable');
          return 'not-an-array';
        },
      },
    });
    await failing.pi.commands.outfitter.handler({}, failingContext);
    expect(fullWidth(failingContext)).toContain('Pi does not have a model provider connected yet.');
  });
});
