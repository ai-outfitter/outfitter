// Exercises the Outfitter runtime extension's identity UI, auto sign-in prompt, and launch wiring.
// THIS TEST GUARDS OFTR-010's runtime login behavior (real pi offers /login when no models are
// available, or prints only the /login hint right after a skipped first-run provider step).
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';

import {
  attachPiRuntimeExtension,
  createPiRuntimeExtensionContent,
  isNonInteractivePiLaunch,
} from '../../src/cli/commands/PiRuntimeLaunch.js';
import type { PiProviderPromptMode, PiRuntimeProfileIdentity } from '../../src/cli/commands/PiRuntimeLaunch.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

type Handler = (event: Record<string, unknown>, context: MockContext) => Promise<unknown>;
type MockContext = ReturnType<typeof createMockContext>;

interface RuntimeFixtureInput {
  readonly profile?: PiRuntimeProfileIdentity;
  readonly providerPrompt?: PiProviderPromptMode;
}

interface MockHeader {
  readonly render: (width?: number) => string[];
  readonly invalidate: () => void;
}

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-runtime-extension-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// Evaluates a stamped runtime extension in a sandbox with Pi's supported imports stubbed out.
const evaluateRuntimeExtension = (input: RuntimeFixtureInput = {}): ((pi: MockPi) => void) => {
  const executable = createPiRuntimeExtensionContent({
    profile: input.profile,
    providerPrompt: input.providerPrompt,
  })
    .replace(
      /import \{ Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi \} from ['"]@earendil-works\/pi-tui['"];/u,
      [
        'const Key = { up: "UP", down: "DOWN", enter: "ENTER", escape: "ESC", ctrl: (key) => "CTRL-" + key };',
        'const matchesKey = (data, key) => data === key;',
        'const visibleWidth = (text) => String(text).length;',
        'const truncateToWidth = (text, width) => String(text).slice(0, width);',
        'const wrapTextWithAnsi = (text) => [String(text)];',
      ].join('\n'),
    )
    .replace('export default function outfitterRuntime', 'function outfitterRuntime');
  const sandbox = {
    globalThis: { outfitterRuntime: undefined as ((pi: MockPi) => void) | undefined },
    setTimeout,
  };
  new Script(`${executable}\nglobalThis.outfitterRuntime = outfitterRuntime;`).runInContext(createContext(sandbox));
  if (sandbox.globalThis.outfitterRuntime === undefined) throw new Error('runtime extension did not evaluate');
  return sandbox.globalThis.outfitterRuntime;
};

type MockPi = ReturnType<typeof createMockPi>;

const createMockPi = () => {
  const handlers: Record<string, Handler[]> = {};
  return {
    handlers,
    on(name: string, handler: Handler) {
      handlers[name] = [...(handlers[name] ?? []), handler];
    },
  };
};

const createMockContext = (options: { models?: readonly unknown[]; confirm?: boolean; mode?: string } = {}) => {
  let editorText = '';
  let header: MockHeader | undefined;
  const rendered: string[][] = [];
  const notifications: string[] = [];
  const statuses: Record<string, string> = {};
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  return {
    mode: options.mode ?? 'tui',
    model: options.models && options.models.length > 0 ? options.models[0] : undefined,
    modelRegistry: { getAvailable: () => Promise.resolve([...(options.models ?? [])]) },
    get editorText() {
      return editorText;
    },
    get header() {
      return header;
    },
    rendered,
    notifications,
    statuses,
    ui: {
      custom<T>(factory: (...args: unknown[]) => unknown): Promise<T> {
        return new Promise<T>((resolve) => {
          const component = factory(
            { requestRender: () => undefined, focusedComponent: { handleInput: () => undefined } },
            theme,
            {},
            resolve,
          ) as {
            outfitterOptions?: readonly string[];
            render?: (width: number) => string[];
            handleInput?: (key: string) => void;
          };
          // A described-option picker (the confirm dialog) exposes outfitterOptions; capture its
          // rendered lines, then drive it by selecting (confirm) or escaping (decline). The submit
          // overlay has no outfitterOptions and resolves via its own timer.
          if (component.outfitterOptions !== undefined) {
            rendered.push(component.render?.(60) ?? []);
            component.handleInput?.(options.confirm === false ? 'ESC' : 'ENTER');
          }
        });
      },
      notify(message: string) {
        notifications.push(message);
      },
      setEditorText(value: string) {
        editorText = value;
      },
      setHeader(factory: (...args: unknown[]) => unknown) {
        header = factory({}, theme) as MockHeader;
      },
      setStatus(id: string, text: string) {
        statuses[id] = text;
      },
      theme,
    },
  };
};

const fireSessionStart = async (
  context: MockContext,
  event: Record<string, unknown> = { reason: 'startup' },
  fixtureInput: RuntimeFixtureInput = {},
) => {
  const extension = evaluateRuntimeExtension(fixtureInput);
  const pi = createMockPi();
  extension(pi);
  for (const handler of pi.handlers.session_start ?? []) await handler(event, context);
};

describe('Pi runtime extension identity UI', () => {
  it('shows one compact Outfitter and active profile header', async () => {
    const context = createMockContext({ models: [{ id: 'm' }] });
    await fireSessionStart(
      context,
      { reason: 'startup' },
      {
        profile: { id: 'engineer', label: 'Engineer' },
      },
    );

    expect(context.header?.render(80)).toEqual(['Outfitter · Engineer']);
    expect(context.statuses).toEqual({});
  });

  it('falls back to the profile id and shows only Outfitter when no profile is stamped', async () => {
    const fallbackContext = createMockContext({ models: [{ id: 'm' }] });
    await fireSessionStart(fallbackContext, { reason: 'startup' }, { profile: { id: 'engineer' } });
    expect(fallbackContext.header?.render(80)).toEqual(['Outfitter · engineer']);

    const absentContext = createMockContext({ models: [{ id: 'm' }] });
    await fireSessionStart(absentContext);
    expect(absentContext.header?.render(80)).toEqual(['Outfitter']);
  });

  it('keeps the header within the terminal width and re-renders after invalidation', async () => {
    const context = createMockContext({ models: [{ id: 'm' }] });
    await fireSessionStart(context);
    const header = context.header!;

    const narrow = header.render(20);
    expect(narrow.every((line) => line.length <= 20)).toBe(true);
    expect(header.render(20)).toBe(narrow);
    expect(header.render()).toEqual(['Outfitter']);
    header.invalidate();
    expect(header.render(20)).not.toBe(narrow);
  });
});

describe('Pi runtime extension auto sign-in', () => {
  it('opens /login after confirmation when no models are available', async () => {
    const context = createMockContext({ models: [], confirm: true });
    await fireSessionStart(context);
    expect(context.editorText).toBe('/login');
    // The confirm dialog restores the original "connect a model provider" wording (matches the
    // pre-#165 pi-login-launch.test.ts assertions that validated this behavior).
    const dialog = context.rendered[0]?.join('\n') ?? '';
    expect(dialog).toContain('Pi does not have a model provider connected yet.');
    expect(dialog).toContain('Connect one now so Outfitter can use Pi.');
    expect(dialog).toContain('Press Enter to open /login');
    expect(dialog).toContain('Connect a model provider');
    // A one-item picker advertises only keys that do something.
    expect(dialog).toContain('enter connect  escape skip');
    expect(dialog).not.toContain('navigate');
    expect(context.notifications).toEqual([]);
  });

  it('does nothing when a model is already available', async () => {
    const context = createMockContext({ models: [{ id: 'm' }] });
    await fireSessionStart(context);
    expect(context.editorText).toBe('');
  });

  it('leaves a one-line /login hint when the user declines the connect prompt', async () => {
    const context = createMockContext({ models: [], confirm: false });
    await fireSessionStart(context);
    expect(context.editorText).toBe('');
    expect(context.notifications).toEqual([
      "No model provider connected yet. Run '/login' inside Outfitter to connect one.",
    ]);
  });

  // The user just pressed Escape on the same dialog inside first-run setup; asking again would be
  // the loop the onboarding flow exists to avoid.
  it('prints only the /login hint in hint mode instead of prompting again', async () => {
    const context = createMockContext({ models: [], confirm: true });
    await fireSessionStart(context, { reason: 'startup' }, { providerPrompt: 'hint' });
    expect(context.editorText).toBe('');
    expect(context.rendered).toEqual([]);
    expect(context.notifications).toEqual([
      "No model provider connected yet. Run '/login' inside Outfitter to connect one.",
    ]);
  });

  it('stays silent in hint mode when a model is available', async () => {
    const context = createMockContext({ models: [{ id: 'm' }] });
    await fireSessionStart(context, { reason: 'startup' }, { providerPrompt: 'hint' });
    expect(context.notifications).toEqual([]);
  });

  it('stays inert outside a TUI session', async () => {
    const context = createMockContext({ models: [], confirm: true, mode: 'json' });
    await fireSessionStart(context, { reason: 'startup' }, { profile: { id: 'engineer' } });
    expect(context.editorText).toBe('');
    expect(context.header).toBeUndefined();
    expect(context.statuses).toEqual({});
  });

  it('only prompts on startup, while restoring identity UI on reload', async () => {
    const context = createMockContext({ models: [], confirm: true });
    await fireSessionStart(context, { reason: 'reload' }, { profile: { id: 'engineer' } });
    expect(context.editorText).toBe('');
    expect(context.header).toBeDefined();
    expect(context.header?.render(80)).toEqual(['Outfitter · engineer']);
  });
});

describe('attachPiRuntimeExtension', () => {
  const piPlan = (args: readonly string[] = []): AgentLaunchPlan => ({ command: 'pi', args, env: {} });
  const runtimeInput = (profile?: PiRuntimeProfileIdentity) => ({
    profile,
    rootDirectory: createTemporaryRoot(),
  });

  it('materializes and prepends the stamped runtime extension for interactive pi launches', () => {
    const result = attachPiRuntimeExtension(
      piPlan(['--system-prompt', '/x']),
      runtimeInput({ id: 'engineer', label: 'Engineer' }),
    );
    expect(result.args[0]).toBe('--extension');
    expect(result.args[1]).toMatch(/\.outfitter\/outfitter-runtime-extension\.js$/u);
    expect(result.args.slice(2)).toEqual(['--system-prompt', '/x']);
    const extension = readFileSync(result.args[1], 'utf8');
    expect(extension).toContain('const OUTFITTER_ACTIVE_PROFILE = {"id":"engineer","label":"Engineer"};');
    expect(extension).toContain('const OUTFITTER_PROVIDER_PROMPT_MODE = "dialog";');
    expect(extension).not.toContain('__OUTFITTER_');
  });

  it('stamps hint mode when the user skipped the provider step during setup', () => {
    const result = attachPiRuntimeExtension(piPlan(), { ...runtimeInput(), providerPrompt: 'hint' });
    const extension = readFileSync(result.args[1], 'utf8');
    expect(extension).toContain('const OUTFITTER_PROVIDER_PROMPT_MODE = "hint";');
    expect(extension).toContain('const OUTFITTER_ACTIVE_PROFILE = undefined;');
  });

  it('does not reinterpret placeholder-shaped profile metadata while stamping', () => {
    const extension = createPiRuntimeExtensionContent({
      profile: { id: 'engineer', label: '__OUTFITTER_VERSION__' },
    });

    expect(extension).toContain('const OUTFITTER_ACTIVE_PROFILE = {"id":"engineer","label":"__OUTFITTER_VERSION__"};');
  });

  it('leaves non-pi launches untouched', () => {
    const claudePlan: AgentLaunchPlan = { command: 'claude', args: ['--model', 'x'], env: {} };
    expect(attachPiRuntimeExtension(claudePlan, runtimeInput())).toBe(claudePlan);
  });

  it('does not attach to non-interactive pi launches', () => {
    for (const args of [['--print'], ['-p'], ['--export'], ['--list-models'], ['--mode', 'json'], ['--mode=rpc']]) {
      expect(attachPiRuntimeExtension(piPlan(args), runtimeInput()).args).toEqual(args);
      expect(isNonInteractivePiLaunch(args)).toBe(true);
    }
  });

  it('treats a plain interactive launch as interactive', () => {
    expect(isNonInteractivePiLaunch(['--system-prompt', '/x', '--mode', 'tui'])).toBe(false);
    expect(isNonInteractivePiLaunch(['--mode'])).toBe(false);
  });
});
