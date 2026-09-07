// Shared harness for the generated Pi `/outfitter` setup extension tests: evaluates the stamped
// extension in a sandbox with pi-tui stubbed and drives its described-option pickers.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

import { createPiSetupExtensionContent } from '../../../src/cli/commands/SetupCommand.js';
import type { SetupAgentChoice } from '../../../src/setup/Setup.js';

const roots: string[] = [];

/** Removes every temporary fixture root; call from `afterEach`. */
export const cleanupFixtures = (): void => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};
const choices: readonly SetupAgentChoice[] = [
  { id: 'engineer', label: 'Engineer', description: 'Engineering profile.', featured: true },
  {
    id: 'founder',
    label: 'Founder',
    description: 'Founder/operator profile for product, planning, and execution.',
    featured: true,
  },
  { id: 'planner', label: 'Planner', description: 'Planning profile.' },
];

export type MockContext = ReturnType<typeof createMockContext>;
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

export const createMockContext = (
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
  // The first described picker is the combined profile/import screen; `mode` drives it and
  // `pickOption` drives every later picker (target, harness, confirmations).
  let pickers = 0;
  const pickFor = (labels: readonly string[]): number | undefined => {
    pickers += 1;
    if (pickers > 1) return options.pickOption?.(labels);
    if (options.mode === 'cancel') return -1;
    if (options.mode === 'catalog') return labels.indexOf('Import a different .agents catalog');
    return options.pickOption?.(labels);
  };
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
            driveDescribedOption(component, pickFor(component.outfitterOptions));
          }
        });
      },
      input: () => Promise.resolve(inputs.shift()),
      notify(message: string) {
        notifications.push(message);
      },
      select(title: string, selectOptions: readonly string[]) {
        selectCalls.push({ title, options: selectOptions });
        return Promise.resolve(selectOptions[0]);
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

export const fixture = (
  options: {
    setupSourceUri?: string;
    visibility?: 'private' | 'public';
    agents?: readonly SetupAgentChoice[];
    currentDefault?: string;
  } = {},
) => {
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
      availableAgents: options.agents ?? choices,
      currentDefault: options.currentDefault,
      setupSourceUri: options.setupSourceUri,
    }),
    options.visibility,
  );
  const pi = createMockPi();
  extension(pi);
  return { pi, resultPath, home, project };
};
