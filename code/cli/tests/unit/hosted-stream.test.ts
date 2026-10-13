import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
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
afterEach(() => vi.unstubAllGlobals());

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
  expect(fetch.mock.calls[0][0]).toBe('https://ai-outfitter.com/v1/chat/completions');
  expect(new Headers(fetch.mock.calls[0][1]?.headers).get('authorization')).toBe('Bearer outfitter-session-token');
});
