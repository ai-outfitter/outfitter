// Typed mock pi runtime for exercising the Outfitter extension against realistic
// extension API shapes. Keyboard input uses real terminal escape sequences because
// the extension consumes the real @earendil-works/pi-tui key matcher.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

import type { OutfitterExtensionConfig } from '../src/config.js';
import { createOutfitterExtension } from '../src/extension.js';
import type { OnboardingFs, OutfitterContext } from '../src/types.js';

const temporaryRoots: string[] = [];

export const createTemporaryRoot = (prefix = 'outfitter-pi-extension-'): string => {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
};

export const cleanupTemporaryRoots = (): void => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop() as string, { recursive: true, force: true });
  }
};

export const writeDefaultProfilesCatalog = (root: string): string => {
  const profilesPath = join(root, 'default-profiles');

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

export type OutfitterImportGlobal = typeof globalThis & {
  __outfitterImport?: (specifier: string) => Promise<unknown>;
};

export interface PrivateCatalogStubOptions {
  readonly visibility?: 'private' | 'public' | 'unknown';
  readonly alreadyEnabled?: boolean;
  readonly confirm?: boolean;
}

// Replaces the enterprise private-catalog module (normally copied next to the built
// artifact by the CLI) through the __outfitterImport hook the extension honors.
export const stubPrivateCatalogModule = (options: PrivateCatalogStubOptions = {}): { enabledWrites: string[] } => {
  const enabledWrites: string[] = [];
  (globalThis as OutfitterImportGlobal).__outfitterImport = (specifier: string) => {
    if (specifier !== './pi-extension/privateCatalogOnboarding.js') {
      throw new Error(`Unexpected onboarding import '${specifier}'.`);
    }

    return Promise.resolve({
      classifyGitHubRepositoryVisibility: () => Promise.resolve(options.visibility ?? 'public'),
      readPrivateProfileCatalogsEnabled: () => options.alreadyEnabled ?? false,
      writePrivateProfileCatalogsEnabled: (fs: OnboardingFs, settingsPath: string) => {
        fs.mkdirSync(fs.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, 'enterprise:\n  private_profile_catalogs: true\n');
        enabledWrites.push(settingsPath);
      },
      confirmPrivateCatalog: () => Promise.resolve(options.confirm ?? true),
    });
  };

  return { enabledWrites };
};

export const clearPrivateCatalogModuleStub = (): void => {
  delete (globalThis as OutfitterImportGlobal).__outfitterImport;
};

export const keySequences = {
  shiftTab: '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  enter: '\r',
  escape: '\x1b',
} as const;

export const createExtensionConfig = (
  overrides: Partial<OutfitterExtensionConfig> & Pick<OutfitterExtensionConfig, 'homeDirectory' | 'projectDirectory'>,
): OutfitterExtensionConfig => ({
  autoOpenOutfitter: false,
  startupAsciiArt: true,
  defaultSettingsTemplate: [
    'default_profile: __OUTFITTER_PROFILE_ID__',
    'profile_sources:',
    '  - github: ai-outfitter/default-profiles',
    '    path: profiles',
    '  - path: ./profiles',
    '',
  ].join('\n'),
  asciiArt: ' ___\n(o o)\n ___',
  ...overrides,
});

export interface MockCommand {
  readonly description?: string;
  readonly handler: (args: string, ctx: unknown) => Promise<void>;
}

export type MockHandler = (event: unknown, ctx: unknown) => unknown;

export interface MockPi {
  readonly commands: Record<string, MockCommand>;
  readonly handlers: Record<string, MockHandler[]>;
  readonly activeTools: string[];
  readonly api: ExtensionAPI;
}

export const createMockPi = (): MockPi => {
  const commands: Record<string, MockCommand> = {};
  const handlers: Record<string, MockHandler[]> = {};
  let activeTools = ['read', 'bash', 'edit', 'write'];

  const api = {
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
  } as unknown as ExtensionAPI;

  return {
    commands,
    handlers,
    get activeTools() {
      return activeTools;
    },
    api,
  };
};

interface MockThemeLike {
  bold(text: string): string;
  fg(color: string, text: string): string;
}

export interface MockContextOptions {
  readonly availableModels?: readonly unknown[];
  readonly getAvailable?: () => unknown;
  readonly hasModelRegistry?: boolean;
  readonly hasUI?: boolean;
  readonly inputValues?: readonly (string | undefined)[];
  readonly mode?: string;
  readonly model?: unknown;
  readonly selectedOptions?: readonly (string | undefined)[];
  readonly systemPrompt?: unknown;
  readonly withCustomUi?: boolean;
  readonly withInputUi?: boolean;
}

export interface MockContext {
  readonly context: OutfitterContext;
  readonly notifications: string[];
  readonly headerRenders: string[][];
  readonly customRenders: string[][];
  readonly inputCalls: { readonly message: string; readonly defaultValue?: string }[];
  readonly selectCalls: { readonly title: string; readonly options: readonly string[] }[];
  readonly submittedInputs: string[];
  readonly statusUpdates: { readonly key: string; readonly text: string | undefined }[];
  readonly editorText: string;
  readonly terminalInputHandler: ((data: string) => { readonly consume?: boolean } | undefined) | undefined;
}

// Mirrors the interactive pieces of pi's ExtensionUIContext that the extension
// touches; described-option selectors are auto-driven from `selectedOptions`.
export const createMockContext = (options: MockContextOptions = {}): MockContext => {
  let editorText = '';
  let terminalInputHandler: ((data: string) => { readonly consume?: boolean } | undefined) | undefined;
  const notifications: string[] = [];
  const selectCalls: { readonly title: string; readonly options: readonly string[] }[] = [];
  const inputCalls: { readonly message: string; readonly defaultValue?: string }[] = [];
  const headerRenders: string[][] = [];
  const customRenders: string[][] = [];
  const submittedInputs: string[] = [];
  const statusUpdates: { readonly key: string; readonly text: string | undefined }[] = [];
  const selectedOptions = [...(options.selectedOptions ?? [])];
  const inputValues = [...(options.inputValues ?? [])];
  const theme: MockThemeLike = {
    bold: (text) => text,
    fg: (_color, text) => text,
  };
  const nextSelectedOption = (fallback: string): string | undefined =>
    selectedOptions.length > 0 ? selectedOptions.shift() : fallback;

  const driveDescribedSelector = (component: {
    outfitterOptions: readonly string[];
    handleInput(input: string): void;
    render?(width: number): string[];
  }): void => {
    customRenders.push(component.render?.(117) ?? []);
    const selected = nextSelectedOption(component.outfitterOptions[0] ?? '');
    if (selected === undefined) {
      component.handleInput(keySequences.escape);
      return;
    }
    const selectedIndex = Math.max(0, component.outfitterOptions.indexOf(selected));
    for (let index = 0; index < selectedIndex; index += 1) {
      component.handleInput(keySequences.down);
    }
    customRenders.push(component.render?.(117) ?? []);
    component.handleInput(keySequences.enter);
  };

  const driveCustomComponent = (component: unknown): void => {
    if (component === null || typeof component !== 'object') {
      return;
    }

    if ('outfitterOptions' in component && 'handleInput' in component) {
      driveDescribedSelector(
        component as {
          outfitterOptions: readonly string[];
          handleInput(input: string): void;
          render?(width: number): string[];
        },
      );
      return;
    }

    if ('render' in component) {
      // Invisible helper components (e.g. the slash-command submitter) still get
      // rendered by pi's overlay machinery.
      const renderable = component as { render(width: number): string[]; invalidate?(): void };
      renderable.render(80);
      renderable.invalidate?.();
    }
  };

  const custom = <T>(
    factory: (tui: unknown, factoryTheme: MockThemeLike, keybindings: unknown, done: (result: T) => void) => unknown,
    customOptions?: { overlayOptions?: { visible?: (width: number, height: number) => boolean } },
  ): Promise<T> =>
    new Promise<T>((resolve) => {
      customOptions?.overlayOptions?.visible?.(80, 24);
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
      driveCustomComponent(component);
    });

  const ui: Record<string, unknown> = {
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
      factory: (tui: unknown, factoryTheme: MockThemeLike) => { render(): string[]; invalidate?(): void },
    ) => {
      const header = factory({}, theme);
      headerRenders.push(header.render());
      header.invalidate?.();
    },
    setStatus: (key: string, text: string | undefined) => {
      statusUpdates.push({ key, text });
    },
    theme,
  };

  if (options.withCustomUi !== false) {
    ui.custom = custom;
  }

  if (options.withInputUi !== false) {
    ui.input = (message: string, inputOptions?: { readonly defaultValue?: string }) => {
      inputCalls.push({ message, defaultValue: inputOptions?.defaultValue });
      return Promise.resolve(inputValues.length > 0 ? inputValues.shift() : (inputOptions?.defaultValue ?? ''));
    };
  }

  const contextRecord: Record<string, unknown> = {
    hasUI: options.hasUI ?? true,
    mode: options.mode ?? 'tui',
    model: options.model,
    getSystemPrompt: () => options.systemPrompt ?? 'mock system prompt',
    ui,
  };

  if (options.hasModelRegistry !== false) {
    contextRecord.modelRegistry = {
      getAvailable: options.getAvailable ?? (() => Promise.resolve(options.availableModels ?? [{}])),
    };
  }

  return {
    context: contextRecord as unknown as OutfitterContext,
    notifications,
    headerRenders,
    customRenders,
    inputCalls,
    selectCalls,
    submittedInputs,
    statusUpdates,
    get editorText() {
      return editorText;
    },
    get terminalInputHandler() {
      return terminalInputHandler;
    },
  };
};

export const startMockSession = async (pi: MockPi, mock: MockContext, reason = 'startup'): Promise<void> => {
  const handler = pi.handlers.session_start?.[0];

  if (handler === undefined) {
    throw new Error('session_start handler was not registered.');
  }

  await handler({ reason }, mock.context);
};

export const runOutfitterCommand = async (pi: MockPi, mock: MockContext): Promise<void> => {
  const command = pi.commands.outfitter;

  if (command === undefined) {
    throw new Error('outfitter command was not registered.');
  }

  await command.handler('', mock.context);
};

export const activateExtension = (
  configOverrides: Partial<OutfitterExtensionConfig> &
    Pick<OutfitterExtensionConfig, 'homeDirectory' | 'projectDirectory'>,
  contextOptions: MockContextOptions = {},
): { pi: MockPi; mock: MockContext } => {
  const pi = createMockPi();
  const mock = createMockContext(contextOptions);
  createOutfitterExtension(createExtensionConfig(configOverrides))(pi.api);
  return { pi, mock };
};
