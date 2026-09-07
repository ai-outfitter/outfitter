import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Script, createContext } from 'node:vm';

import { expect, it } from 'vitest';

interface Profile {
  id: string;
  fingerprint: string;
  envelope: string;
  prompt: string;
  skills: object[];
  mcpServers: Record<string, unknown>;
  model?: string;
  thinking?: string;
  tools?: { allow?: string[]; deny?: string[] };
}

const createFixture = (extraTools: string[] = []) => {
  const first: Profile = {
    id: 'first',
    fingerprint: 'aaa',
    envelope: 'same',
    prompt: 'FIRST',
    skills: [],
    mcpServers: {},
  };
  const second: Profile = {
    ...first,
    id: 'second',
    fingerprint: 'bbb',
    prompt: 'SECOND',
    tools: { allow: ['read', 'write'], deny: ['write'] },
  };
  let activeTools = ['read', 'write', ...extraTools];
  let thinking = 'off';
  let failModel = false;
  let wait = Promise.resolve();
  const context = {
    cwd: process.cwd(),
    model: { provider: 'fixture', id: 'model' },
    modelRegistry: { getAvailable: () => Promise.resolve([{ provider: 'fixture', id: 'model' }]) },
    sessionManager: { getLeafId: () => 'leaf' },
    waitForIdle: () => wait,
    ui: { notify: (text: string) => notifications.push(text) },
  };
  type Handler = (
    event: object,
    ctx: typeof context,
  ) => Promise<{ systemPrompt?: string; action?: string } | undefined>;
  let command: { handler: (args: string, ctx: typeof context) => Promise<void> } | undefined;
  const handlers: Record<string, Handler> = {};
  const notifications: string[] = [];
  const audit: object[] = [];
  const headers: string[] = [];
  const pi = {
    on: (name: string, handler: Handler) => {
      handlers[name] = handler;
    },
    registerCommand: (_name: string, handler: typeof command) => {
      command = handler;
    },
    getActiveTools: () => activeTools,
    getAllTools: () => ['read', 'write', ...extraTools].map((name) => ({ name })),
    getThinkingLevel: () => thinking,
    setThinkingLevel: (level: string) => {
      thinking = level;
    },
    setActiveTools: (tools: string[]) => {
      activeTools = tools;
    },
    setModel: () => Promise.resolve(!failModel),
    appendEntry: (_type: string, entry: object) => audit.push(entry),
    sendMessage: () => {},
  };
  const source = readFileSync(resolve('../pi-extension/src/outfitter-profile-controller.js'), 'utf8')
    .replace("import { stageMcp } from './outfitter-mcp.js';", '')
    .replace('export function installProfileController', 'function installProfileController');
  const sandbox = {
    stageMcp: () => Promise.resolve({ tools: [], close: () => {} }),
    profiles: [first, second],
    pi,
    updateHeader: (_ctx: unknown, profile: Profile) => headers.push(profile.id),
  };
  new Script(`${source}\ninstallProfileController(pi, profiles, 'first', updateHeader);`).runInContext(
    createContext(sandbox),
  );
  return {
    first,
    second,
    handlers,
    context,
    notifications,
    audit,
    headers,
    switch: (args: string) => command!.handler(args, context),
    tools: () => activeTools,
    wait: (value: Promise<void>) => {
      wait = value;
    },
    failModel: () => {
      failModel = true;
    },
  };
};

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('waits for the idle boundary before changing prompt, tools, header, or persisted fingerprint', async () => {
  const fixture = createFixture();
  await fixture.handlers.session_start({}, fixture.context);
  let release = () => {};
  fixture.wait(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  const switching = fixture.switch('profile second');
  await Promise.resolve();
  expect(await fixture.handlers.before_agent_start({}, fixture.context)).toEqual({ systemPrompt: 'FIRST' });
  expect(fixture.headers).toEqual(['first']);
  expect(fixture.audit).toHaveLength(1);
  release();
  await switching;
  expect(await fixture.handlers.before_agent_start({}, fixture.context)).toEqual({ systemPrompt: 'SECOND' });
  expect(fixture.tools()).toEqual(['read']);
  expect(fixture.headers).toEqual(['first', 'second']);
  expect(fixture.audit[1]).toMatchObject({
    oldFingerprint: 'aaa',
    newFingerprint: 'bbb',
    turnBoundary: 0,
    sessionLeaf: 'leaf',
  });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('preserves the previous state for missing tools, model activation failure and invalid thinking', async () => {
  const fixture = createFixture();
  await fixture.handlers.session_start({}, fixture.context);
  fixture.second.tools = { allow: ['unavailable'] };
  await fixture.switch('profile second');
  expect(fixture.notifications.at(-1)).toContain('unavailable');
  fixture.second.tools = { allow: [] };
  fixture.second.thinking = 'invalid';
  await fixture.switch('profile second');
  expect(fixture.notifications.at(-1)).toContain('Unsupported thinking');
  fixture.second.thinking = 'off';
  fixture.failModel();
  await fixture.switch('profile second');
  expect(fixture.notifications.at(-1)).toContain('could not activate');
  expect(fixture.tools()).toEqual(['read', 'write']);
  expect(fixture.headers).toEqual(['first']);
  expect(fixture.audit).toHaveLength(1);
  expect(await fixture.handlers.before_agent_start({}, fixture.context)).toEqual({ systemPrompt: 'FIRST' });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('fails closed for input when initial activation fails and accepts an explicitly empty tool allowlist', async () => {
  const fixture = createFixture();
  fixture.first.model = 'unavailable/model';
  await expect(fixture.handlers.session_start({}, fixture.context)).rejects.toThrow('unavailable');
  expect(await fixture.handlers.input({}, fixture.context)).toEqual({ action: 'handled' });
  expect(fixture.audit).toEqual([]);
  fixture.second.tools = { allow: [] };
  await fixture.switch('profile second');
  expect(fixture.tools()).toEqual([]);
  expect(await fixture.handlers.input({}, fixture.context)).toEqual({ action: 'continue' });
  await fixture.switch('invalid arguments');
  expect(fixture.notifications.at(-1)).toContain('Usage: /outfitter profile');
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('excludes legacy MCP tools without disabling unrelated extension tools', async () => {
  const fixture = createFixture(['mcp_legacy', 'unrelated_extension']);
  await fixture.handlers.session_start({}, fixture.context);
  expect(fixture.tools()).toEqual(['read', 'write', 'unrelated_extension']);
  expect(fixture.notifications[0]).toContain('Legacy MCP extension tools are disabled');
  fixture.second.tools = { allow: ['mcp_legacy'] };
  await fixture.switch('profile second');
  expect(fixture.notifications.at(-1)).toContain('cannot bypass');
  expect(fixture.tools()).toEqual(['read', 'write', 'unrelated_extension']);
  expect(fixture.audit).toHaveLength(1);
});
