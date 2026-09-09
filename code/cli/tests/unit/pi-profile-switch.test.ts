// Exercises in-session compiled profile switching in the Outfitter runtime Pi extension: prompt
// replacement, selector application, audit entry, and failure atomicity.
// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.8.9): `/outfitter profile <slug>` switches the
// active composition for the next turn, replacing the system prompt, and a failed activation leaves
// the prior profile and selectors unchanged.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Script, createContext } from 'node:vm';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiRuntimeExtensionContent } from '../../src/cli/commands/PiRuntimeLaunch.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

interface RegistryProfile {
  readonly agent: string;
  readonly fingerprint: string;
  readonly label?: string;
  readonly systemPrompt: string;
  readonly skills?: readonly { slug: string; name: string; description?: string }[];
  readonly model?: string;
  readonly thinking?: string;
  readonly toolAllowlist?: readonly string[];
}

const writeRegistry = (profiles: readonly RegistryProfile[]): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-profile-switch-'));
  roots.push(root);
  const path = join(root, 'registry.json');
  write(path, `${JSON.stringify({ version: 1, profiles }, null, 2)}\n`);
  return path;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const engineer: RegistryProfile = {
  agent: 'engineer',
  fingerprint: 'sha256:engineer',
  label: 'Engineer',
  systemPrompt: 'Engineer prompt.',
  skills: [{ slug: 'deploy', name: 'deploy', description: 'Ship code.' }],
  model: 'anthropic/claude-sonnet-4-5',
  thinking: 'high',
  toolAllowlist: ['read', 'edit'],
};
const founder: RegistryProfile = {
  agent: 'founder',
  fingerprint: 'sha256:founder',
  label: 'Founder',
  systemPrompt: 'Founder prompt.',
  thinking: 'low',
};

const evaluateExtension = (registryPath: string | undefined): ((pi: MockPi) => void) => {
  const executable = createPiRuntimeExtensionContent({
    profile: { id: 'engineer', label: 'Engineer' },
    profilesRegistryPath: registryPath,
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
    .replace(/import\(['"]node:fs['"]\)/gu, 'globalThis.__import("node:fs")')
    .replace('export default function outfitterRuntime', 'function outfitterRuntime');
  const sandbox = {
    globalThis: {
      __import: (specifier: string): Promise<unknown> => import(specifier),
      outfitterRuntime: undefined as ((pi: MockPi) => void) | undefined,
    },
    setTimeout,
  };
  new Script(`${executable}\nglobalThis.outfitterRuntime = outfitterRuntime;`).runInContext(createContext(sandbox));
  if (sandbox.globalThis.outfitterRuntime === undefined) throw new Error('runtime extension did not evaluate');
  return sandbox.globalThis.outfitterRuntime;
};

type Handler = (event: Record<string, unknown>, context: MockContext) => Promise<unknown>;
type MockContext = ReturnType<typeof createMockContext>;
type MockPi = ReturnType<typeof createMockPi>;

const createMockPi = () => {
  const handlers: Record<string, Handler[]> = {};
  const commands: Record<string, { handler: (args: string, ctx: MockContext) => Promise<void> | void }> = {};
  const entries: { customType: string; data: unknown }[] = [];
  let activeTools: string[] = ['read', 'bash', 'edit'];
  let thinkingLevel = 'medium';
  let failingSetModel = false;
  const setModelCalls: unknown[] = [];
  return {
    handlers,
    commands,
    entries,
    get failSetModel() {
      return failingSetModel;
    },
    set failSetModel(value: boolean) {
      failingSetModel = value;
    },
    on(name: string, handler: Handler) {
      handlers[name] = [...(handlers[name] ?? []), handler];
    },
    registerCommand(name: string, options: { handler: (args: string, ctx: MockContext) => Promise<void> | void }) {
      commands[name] = options;
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data });
    },
    getActiveTools: () => [...activeTools],
    getAllTools: () => [{ name: 'read' }, { name: 'bash' }, { name: 'edit' }, { name: 'write' }],
    setActiveTools: (names: readonly string[]) => {
      activeTools = [...names];
    },
    get activeTools() {
      return activeTools;
    },
    getThinkingLevel: () => thinkingLevel,
    setThinkingLevel: (level: string) => {
      thinkingLevel = level;
    },
    get thinkingLevel() {
      return thinkingLevel;
    },
    setModel: (model: unknown) => {
      setModelCalls.push(model);
      return Promise.resolve(!failingSetModel);
    },
    get setModelCalls() {
      return setModelCalls;
    },
  };
};

const createMockContext = () => {
  const notifications: { message: string; type?: string }[] = [];
  const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
  let header: { render: (width?: number) => string[]; invalidate: () => void } | undefined;
  let headerFactories = 0;
  return {
    mode: 'tui' as const,
    model: undefined,
    // A connected provider is present, so the auto sign-in prompt never opens.
    modelRegistry: {
      getAvailable: () => Promise.resolve([{ id: 'claude-sonnet-4-5', provider: 'anthropic' }]),
      find: (provider: string | undefined, id: string) =>
        provider === 'anthropic' && id === 'claude-sonnet-4-5' ? { provider, id } : undefined,
    },
    notifications,
    headerFactories: () => headerFactories,
    get header() {
      return header;
    },
    ui: {
      notify(message: string, type?: string) {
        notifications.push({ message, type });
      },
      setHeader(factory: (...args: unknown[]) => unknown) {
        headerFactories += 1;
        header = factory({}, theme) as typeof header;
      },
      theme,
    },
  };
};

const boot = (registryPath: string | undefined) => {
  const extension = evaluateExtension(registryPath);
  const pi = createMockPi();
  const context = createMockContext();
  extension(pi);
  return { pi, context };
};

/** Boots with a started session so the Outfitter header exists before any switch. */
const bootSession = async (registryPath: string | undefined) => {
  const boot0 = boot(registryPath);
  for (const handler of boot0.pi.handlers.session_start ?? []) {
    await handler({ reason: 'startup' }, boot0.context);
  }
  return boot0;
};

const runCommand = async (pi: MockPi, context: MockContext, args: string) => {
  await pi.commands.outfitter.handler(args, context);
};

const beforeAgentStart = async (pi: MockPi) => {
  const handlers = pi.handlers.before_agent_start ?? [];
  expect(handlers.length).toBe(1);
  return handlers[0]({}, {} as MockContext);
};

describe('Outfitter profile switching', () => {
  it('switches to a compiled profile, replaces the next-turn prompt, and appends the audit entry', async () => {
    const registryPath = writeRegistry([engineer, founder]);
    const { pi, context } = await bootSession(registryPath);

    await runCommand(pi, context, 'profile founder');

    expect(context.notifications.at(-1)?.message).toContain('Outfitter profile: founder');
    // No model, no tool allowlist: selectors that the profile does not declare stay untouched.
    expect(pi.setModelCalls).toHaveLength(0);
    expect(pi.thinkingLevel).toBe('low');
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit']);
    expect(pi.entries).toHaveLength(1);
    expect(pi.entries[0]).toEqual({
      customType: 'outfitter-profile-change',
      data: {
        from: 'engineer',
        to: 'founder',
        fromFingerprint: undefined,
        toFingerprint: 'sha256:founder',
        boundary: 'next-turn',
      },
    });
    // The header re-renders with the destination profile label.
    expect(context.headerFactories()).toBe(2);
    expect(context.header!.render(80)).toEqual(['Outfitter · Founder']);

    const result = (await beforeAgentStart(pi)) as { systemPrompt: string };
    expect(result.systemPrompt).toBe('Founder prompt.');
  });

  it('exposes only the destination profile skills and applies model, thinking, and tools', async () => {
    const registryPath = writeRegistry([engineer, founder]);
    const { pi, context } = boot(registryPath);

    // Launch profile is engineer; switching away and back exercises the full selector path.
    await runCommand(pi, context, 'profile founder');
    await runCommand(pi, context, 'profile engineer');

    expect(pi.setModelCalls).toEqual([{ provider: 'anthropic', id: 'claude-sonnet-4-5' }]);
    expect(pi.thinkingLevel).toBe('high');
    expect(pi.activeTools).toEqual(['read', 'edit']);
    const result = (await beforeAgentStart(pi)) as { systemPrompt: string };
    expect(result.systemPrompt).toContain('Engineer prompt.');
    expect(result.systemPrompt).toContain('## Skills\n- deploy: Ship code.');
    expect(result.systemPrompt).not.toContain('Founder prompt.');
  });

  it('leaves the prior profile and every selector unchanged when the slug is unknown', async () => {
    const registryPath = writeRegistry([engineer, founder]);
    const { pi, context } = boot(registryPath);

    await runCommand(pi, context, 'profile ghost');

    expect(context.notifications[0]?.type).toBe('error');
    expect(context.notifications[0]?.message).toContain("No compiled profile 'ghost'");
    expect(pi.setModelCalls).toHaveLength(0);
    expect(pi.thinkingLevel).toBe('medium');
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit']);
    expect(pi.entries).toHaveLength(0);
    expect(await beforeAgentStart(pi)).toBeUndefined();
  });

  it('leaves the prior profile and selectors unchanged when the model is unavailable', async () => {
    const ghost: RegistryProfile = { ...founder, agent: 'ghost', model: 'ghost/model' };
    const registryPath = writeRegistry([engineer, ghost]);
    const { pi, context } = await bootSession(registryPath);

    await runCommand(pi, context, 'profile ghost');

    expect(context.notifications.at(-1)?.type).toBe('error');
    expect(context.notifications.at(-1)?.message).toContain('not available in this session');
    expect(pi.setModelCalls).toHaveLength(0);
    expect(pi.thinkingLevel).toBe('medium');
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit']);
    expect(pi.entries).toHaveLength(0);
    expect(context.header!.render(80)).toEqual(['Outfitter · Engineer']);
  });

  it('rolls selectors back when the model switch itself fails', async () => {
    const registryPath = writeRegistry([engineer, founder]);
    const { pi, context } = boot(registryPath);
    pi.failSetModel = true;

    await runCommand(pi, context, 'profile engineer');

    expect(context.notifications.at(-1)?.type).toBe('error');
    expect(context.notifications.at(-1)?.message).toContain('failed');
    expect(pi.thinkingLevel).toBe('medium');
    expect(pi.activeTools).toEqual(['read', 'bash', 'edit']);
    expect(pi.entries).toHaveLength(0);
    expect(await beforeAgentStart(pi)).toBeUndefined();
  });

  it('reports a missing registry without changing anything', async () => {
    const missing = join(mkdtempSync(join(tmpdir(), 'outfitter-profile-switch-none-')), 'absent.json');
    roots.push(dirname(missing));
    const { pi, context } = boot(missing);

    await runCommand(pi, context, 'profile founder');

    expect(context.notifications[0]?.type).toBe('error');
    expect(context.notifications[0]?.message).toContain('No compiled profile registry was found');
    expect(await beforeAgentStart(pi)).toBeUndefined();
  });

  it('leaves the launch-time system prompt untouched until a switch happens', async () => {
    const registryPath = writeRegistry([engineer, founder]);
    const { pi } = boot(registryPath);
    expect(await beforeAgentStart(pi)).toBeUndefined();
  });
});
