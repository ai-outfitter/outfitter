import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type CreateAgentSessionRuntimeFactory,
} from '@earendil-works/pi-coding-agent';
import { HostedClient } from '../../src/hosted/HostedClient.js';

// Resolve the exact Pi AI runtime bundled with the installed harness, not another SDK version.
const require = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const aiPath = require.resolve
  .paths('@earendil-works/pi-ai')!
  .map((directory) => join(directory, '@earendil-works/pi-ai/dist/compat.js'))
  .find((path) => existsSync(path))!;
interface NativeStream {
  streamSimple(
    model: unknown,
    context: unknown,
    options: { apiKey: string },
  ): {
    result(): Promise<{
      content: Array<{ type: string; text?: string; name?: string; arguments?: unknown }>;
      stopReason: string;
    }>;
  };
}
const ai = (await import(pathToFileURL(aiPath).href)) as NativeStream;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('runs the actual Pi streaming adapter against gateway text and tool-call SSE', async () => {
  const payloads = [
    { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello ' }, finish_reason: null }] },
    {
      choices: [
        {
          index: 0,
          delta: {
            content: 'Outfitter',
            tool_calls: [
              { index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"id":' } },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index: 0, function: { arguments: '42}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    },
    { choices: [], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } },
  ];
  const body =
    payloads
      .map(
        (chunk) =>
          `data: ${JSON.stringify({ id: 'generation-test', object: 'chat.completion.chunk', created: 1, model: 'test', ...chunk })}\n\n`,
      )
      .join('') + 'data: [DONE]\n\n';
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
  vi.stubGlobal('fetch', fetch);
  const client = new HostedClient();
  const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
  registry.registerProvider(
    'outfitter',
    client.provider([
      {
        id: 'test',
        name: 'Test',
        reasoning: false,
        input: ['text'],
        contextWindow: 4096,
        maxTokens: 512,
        cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        compat: { maxTokensField: 'max_tokens', supportsStore: false },
      },
    ]),
  );
  const result = await ai
    .streamSimple(
      registry.find('outfitter', 'test'),
      {
        messages: [{ role: 'user', content: 'Hello', timestamp: 1 }],
        tools: [
          {
            name: 'lookup',
            description: 'Look up an item',
            parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] },
          },
        ],
      },
      { apiKey: 'outfitter-session-token' },
    )
    .result();
  expect(result.stopReason).toBe('toolUse');
  expect(result.content).toContainEqual({ type: 'text', text: 'Hello Outfitter' });
  expect(result.content).toContainEqual(
    expect.objectContaining({ type: 'toolCall', name: 'lookup', arguments: { id: 42 } }),
  );
  expect(fetch.mock.calls[0][0]).toBe('https://ai-outfitter.com/api/inference/v1/chat/completions');
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer outfitter-session-token');
});

it('sends the live session ID on Pi turns, compaction, and new and resumed sessions', async () => {
  const home = mkdtempSync(join(tmpdir(), 'outfitter-metering-'));
  const agentDir = join(home, '.pi', 'agent');
  const sessionDir = join(home, 'sessions');
  mkdirSync(join(home, '.agents'), { recursive: true });
  writeFileSync(join(home, '.agents/settings.yml'), 'experimental:\n  outfitter_provider: true\n');
  vi.stubEnv('OUTFITTER_USER_HOME', home);
  vi.stubEnv('PI_CODING_AGENT_DIR', agentDir);
  vi.stubEnv('SYNTHETIC_INFERENCE_KEY', 'synthetic-inference-key');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
  writeFileSync(
    join(agentDir, 'models.json'),
    JSON.stringify({
      providers: {
        'synthetic-ocean': {
          api: 'outfitter-chat-completions',
          baseUrl: 'https://ocean.example.test/api/inference/v1',
          apiKey: '$SYNTHETIC_INFERENCE_KEY',
          models: [{ id: 'test', name: 'Test', contextWindow: 8192, maxTokens: 512 }],
        },
      },
    }),
  );

  const sent: Array<{ session: string | null; authenticated: boolean }> = [];
  const requestKeys: Array<string | null> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const authenticated = headers.get('authorization') === 'Bearer synthetic-inference-key';
      if (url.href !== 'https://ocean.example.test/api/inference/v1/chat/completions')
        throw new Error('Unexpected fixture destination');
      sent.push({ session: headers.get('x-outfitter-session-id'), authenticated });
      requestKeys.push(headers.get('idempotency-key'));
      const chunk = {
        id: 'synthetic',
        created: 1,
        model: 'test',
        choices: [{ index: 0, delta: { role: 'assistant', content: 'Fixture response' }, finish_reason: 'stop' }],
      };
      return Promise.resolve(
        new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { 'content-type': 'text/event-stream' },
        }),
      );
    }),
  );
  const create: CreateAgentSessionRuntimeFactory = async (target) => {
    const services = await createAgentSessionServices({
      cwd: home,
      agentDir,
      resourceLoaderOptions: {
        additionalExtensionPaths: [fileURLToPath(new URL('../../src/hosted/PiProvider.ts', import.meta.url))],
        noSkills: true,
        noContextFiles: true,
      },
    });
    const session = await createAgentSessionFromServices({
      ...target,
      services,
      model: services.modelRegistry.find('synthetic-ocean', 'test'),
      noTools: 'all',
    });
    return { ...session, services, diagnostics: [] };
  };
  const runtime = await createAgentSessionRuntime(create, {
    cwd: home,
    agentDir,
    sessionManager: SessionManager.create(home, sessionDir),
  });
  runtime.setRebindSession((session) => session.bindExtensions({ mode: 'rpc' }));
  try {
    await runtime.session.bindExtensions({ mode: 'rpc' });
    const first = runtime.session.sessionId;
    await runtime.session.prompt('Synthetic turn one');
    await runtime.session.prompt('Synthetic turn two');
    expect(sent).toEqual([first, first].map((session) => ({ session, authenticated: true })));
    const beforeCompaction = sent.length;
    await runtime.session.compact();
    const compacted = sent.slice(beforeCompaction);
    expect(compacted.length).toBeGreaterThan(0);
    expect(compacted.every((request) => request.session === first && request.authenticated)).toBe(true);
    const afterCompaction = sent.length;
    const firstPath = runtime.session.sessionFile!;
    expect((await runtime.newSession()).cancelled).toBe(false);
    const second = runtime.session.sessionId;
    expect(second).not.toBe(first);
    await runtime.session.prompt('Synthetic turn three');
    expect((await runtime.switchSession(firstPath)).cancelled).toBe(false);
    expect(runtime.session.sessionId).toBe(first);
    await runtime.session.prompt('Synthetic turn four');
    expect(sent.slice(afterCompaction)).toEqual([second, first].map((session) => ({ session, authenticated: true })));
    expect(requestKeys.every((key) => Boolean(key))).toBe(true);
    expect(new Set(requestKeys).size).toBe(sent.length);
  } finally {
    await runtime.dispose();
    rmSync(home, { recursive: true, force: true });
  }
});
