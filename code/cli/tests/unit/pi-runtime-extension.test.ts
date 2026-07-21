// Exercises the Outfitter runtime extension's auto sign-in prompt and the launch-time wiring that
// attaches it. THIS TEST GUARDS OFTR-010's runtime login behavior (real pi opens /login when no
// models are available; the isolated setup pi never does).
import { readFileSync } from 'node:fs';
import { Script, createContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import { attachPiRuntimeExtension, isNonInteractivePiLaunch } from '../../src/cli/commands/PiRuntimeLaunch.js';

type Handler = (event: Record<string, unknown>, context: MockContext) => Promise<unknown>;
type MockContext = ReturnType<typeof createMockContext>;

const runtimeExtensionSource = readFileSync(
  new URL('../../../pi-extension/src/outfitter-runtime-extension.js', import.meta.url),
  'utf8',
);

// Evaluates the runtime extension in a sandbox with pi-tui stubbed out, returning its factory.
const evaluateRuntimeExtension = (): ((pi: MockPi) => void) => {
  const executable = runtimeExtensionSource
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
  const rendered: string[][] = [];
  return {
    mode: options.mode ?? 'tui',
    model: options.models && options.models.length > 0 ? options.models[0] : undefined,
    modelRegistry: { getAvailable: () => Promise.resolve([...(options.models ?? [])]) },
    get editorText() {
      return editorText;
    },
    rendered,
    ui: {
      custom<T>(factory: (...args: unknown[]) => unknown): Promise<T> {
        return new Promise<T>((resolve) => {
          const component = factory(
            { requestRender: () => undefined, focusedComponent: { handleInput: () => undefined } },
            { fg: (_color: string, text: string) => text, bold: (text: string) => text },
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
      setEditorText(value: string) {
        editorText = value;
      },
    },
  };
};

const fireSessionStart = async (context: MockContext, event: Record<string, unknown> = { reason: 'startup' }) => {
  const extension = evaluateRuntimeExtension();
  const pi = createMockPi();
  extension(pi);
  for (const handler of pi.handlers.session_start ?? []) await handler(event, context);
};

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
    expect(dialog).toContain('Credentials stay inside Pi.');
    expect(dialog).toContain('Connect a model provider');
  });

  it('does nothing when a model is already available', async () => {
    const context = createMockContext({ models: [{ id: 'm' }] });
    await fireSessionStart(context);
    expect(context.editorText).toBe('');
  });

  it('does not open /login when the user declines the connect prompt', async () => {
    const context = createMockContext({ models: [], confirm: false });
    await fireSessionStart(context);
    expect(context.editorText).toBe('');
  });

  it('stays inert outside a TUI session', async () => {
    const context = createMockContext({ models: [], confirm: true, mode: 'json' });
    await fireSessionStart(context);
    expect(context.editorText).toBe('');
  });

  it('only prompts on startup, not on reload', async () => {
    const context = createMockContext({ models: [], confirm: true });
    await fireSessionStart(context, { reason: 'reload' });
    expect(context.editorText).toBe('');
  });
});

describe('attachPiRuntimeExtension', () => {
  const piPlan = (args: readonly string[] = []): AgentLaunchPlan => ({ command: 'pi', args, env: {} });

  it('prepends the runtime extension to interactive pi launches', () => {
    const result = attachPiRuntimeExtension(piPlan(['--system-prompt', '/x']));
    expect(result.args[0]).toBe('--extension');
    expect(result.args[1]).toMatch(/outfitter-runtime-extension\.js$/u);
    expect(result.args.slice(2)).toEqual(['--system-prompt', '/x']);
  });

  it('leaves non-pi launches untouched', () => {
    const claudePlan: AgentLaunchPlan = { command: 'claude', args: ['--model', 'x'], env: {} };
    expect(attachPiRuntimeExtension(claudePlan)).toBe(claudePlan);
  });

  it('does not attach to non-interactive pi launches', () => {
    for (const args of [['--print'], ['-p'], ['--export'], ['--list-models'], ['--mode', 'json'], ['--mode=rpc']]) {
      expect(attachPiRuntimeExtension(piPlan(args)).args).toEqual(args);
      expect(isNonInteractivePiLaunch(args)).toBe(true);
    }
  });

  it('treats a plain interactive launch as interactive', () => {
    expect(isNonInteractivePiLaunch(['--system-prompt', '/x', '--mode', 'tui'])).toBe(false);
  });
});
