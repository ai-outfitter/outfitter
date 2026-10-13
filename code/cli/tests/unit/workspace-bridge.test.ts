import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectWorkspace, type BridgeOptions } from '../../src/hosted/WorkspaceBridge.js';
import type { WorkspaceClient } from '../../src/hosted/WorkspaceClient.js';

const id = '11111111-1111-4111-8111-111111111111';
const installation = '22222222-2222-4222-8222-222222222222';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const request = (changes: Record<string, unknown> = {}) => ({
  type: 'request',
  id: 'delivery',
  method: 'GET',
  path: '/tasks/own',
  body: '',
  ...changes,
});
function transport(
  frames: Record<string, unknown>[],
  options: { firstFailure?: 'error' | 'close'; pressure?: boolean; cancelOnHead?: boolean } = {},
) {
  const abort = new AbortController();
  const sent: Record<string, unknown>[] = [];
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = 1;
    bufferedAmount = options.pressure ? 2 * 1024 * 1024 : 0;
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(raw: string) {
      const frame = JSON.parse(raw) as Record<string, unknown>;
      sent.push(frame);
      if (frame.ticket)
        queueMicrotask(() => {
          if (options.firstFailure === 'error') {
            this.dispatchEvent(new Event('error'));
            this.close();
            return;
          }
          if (options.firstFailure === 'close') {
            this.close();
            return;
          }
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) }));
          for (const item of frames) this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(item) }));
          if (options.pressure)
            setTimeout(() => {
              this.bufferedAmount = 0;
            }, 15);
        });
      if (options.cancelOnHead && frame.type === 'head') abort.abort();
      if (['end', 'error', 'input'].includes(String(frame.type))) abort.abort();
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      abort.abort();
      this.dispatchEvent(new Event('close'));
    }
  }
  vi.stubGlobal('WebSocket', Socket);
  const ticket = vi.fn(() => Promise.resolve({ url: 'wss://gateway.example/bridge', ticket: 'ticket' }));
  const client = { ticket } as unknown as WorkspaceClient;
  const connect = (overrides: Partial<BridgeOptions> = {}) =>
    connectWorkspace(client, {
      id,
      installation,
      serviceURL: 'http://127.0.0.1:8000',
      capability: 'ptc1.own.self.mac',
      signal: abort.signal,
      ...overrides,
    });
  return { connect, sent, abort, ticket };
}

describe('workspace bridge failure and stream boundaries', () => {
  it.each([
    request({ path: '//evil.example/steal' }),
    request({ path: '/tasks/../secrets' }),
    request({ path: '/tasks/%2e%2e/secrets' }),
    request({ path: 'relative' }),
    request({ method: 'TRACE' }),
    request({ id: undefined }),
    request({ type: 'unknown' }),
  ])('refuses malformed or redirected callback frames before forwarding: %j', async (frame) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const bridge = transport([frame]);
    await bridge.connect();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('refuses oversized callback bodies before contacting the service', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const bridge = transport([request({ body: Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64') })]);
    await bridge.connect();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('handles an empty HEAD response and unknown cancellation without a body', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetcher);
    const bridge = transport([{ type: 'cancel', id: 'missing' }, request({ method: 'HEAD' })]);
    await bridge.connect();
    expect(fetcher.mock.calls[0]).toBeDefined();
    expect(bridge.sent).toContainEqual({ type: 'head', id: 'delivery', status: 204, contentType: null });
    expect(bridge.sent.some((frame) => frame.type === 'chunk')).toBe(false);
  });
  it('backs off buffered output and streams it once', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('streamed output')));
    const bridge = transport([request()], { pressure: true });
    await bridge.connect();
    expect(bridge.sent.filter((frame) => frame.type === 'chunk')).toHaveLength(1);
  });
  it('does not emit stream data after transport is cancelled at the response header', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('unacknowledged body')));
    const bridge = transport([request()], { cancelOnHead: true });
    await bridge.connect();
    expect(bridge.sent.some((frame) => frame.type === 'head')).toBe(true);
    expect(bridge.sent.some((frame) => frame.type === 'chunk')).toBe(false);
  });
  it('cancels an in-flight callback when the gateway cancels the stream', async () => {
    let cancelled = false;
    vi.stubGlobal(
      'fetch',
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            cancelled = true;
            reject(new Error('cancelled'));
          });
        }),
    );
    const bridge = transport([request(), { type: 'cancel', id: 'delivery' }]);
    await bridge.connect();
    expect(cancelled).toBe(true);
    expect(bridge.sent.some((frame) => frame.type === 'error')).toBe(true);
  });
  it('does not permit concurrent callbacks with the same delivery ID', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('closed')));
        }),
    );
    const bridge = transport([request(), request()]);
    await bridge.connect();
    expect(bridge.sent.some((frame) => frame.type === 'end')).toBe(false);
  });
  it.each(['error', 'close'] as const)(
    'surfaces initial transport %s instead of reporting ready',
    async (firstFailure) => {
      const bridge = transport([], { firstFailure });
      await expect(bridge.connect()).rejects.toThrow(/unavailable|authorization/);
    },
  );
  it('keeps terminal traffic separate from HTTP callbacks', async () => {
    const output = vi.fn();
    const bridge = transport([{ type: 'output', data: Buffer.from('tmux').toString('base64') }, { type: 'ignored' }]);
    await bridge.connect({
      terminal: true,
      capability: undefined,
      serviceURL: undefined,
      output,
      ready: () => queueMicrotask(() => process.stdin.emit('data', Buffer.from('operator input'))),
    });
    expect(output).toHaveBeenCalledWith(Buffer.from('tmux'));
    expect(bridge.sent).toContainEqual({ type: 'input', data: Buffer.from('operator input').toString('base64') });
    expect(bridge.sent.some((frame) => frame.type === 'resize')).toBe(true);
  });
  it('does not open any transport after cancellation', async () => {
    const bridge = transport([]);
    bridge.abort.abort();
    await bridge.connect();
    expect(bridge.ticket).not.toHaveBeenCalled();
  });
});

it('requires a configured origin and a capability before connecting callbacks', async () => {
  const bridge = transport([]);
  await expect(bridge.connect({ serviceURL: undefined })).rejects.toThrow();
  await expect(bridge.connect({ capability: undefined })).rejects.toThrow('task-scoped');
  expect(bridge.ticket).not.toHaveBeenCalled();
});

it('uses actual terminal dimensions and tolerates an omitted output consumer', async () => {
  const columns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const rows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
  Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 40 });
  const bridge = transport([{ type: 'output', data: Buffer.from('tmux').toString('base64') }]);
  try {
    await bridge.connect({
      terminal: true,
      output: undefined,
      ready: () => queueMicrotask(() => process.stdin.emit('data', Buffer.from('input'))),
    });
    expect(bridge.sent).toContainEqual({ type: 'resize', columns: 120, rows: 40 });
  } finally {
    if (columns) Object.defineProperty(process.stdout, 'columns', columns);
    else Reflect.deleteProperty(process.stdout, 'columns');
    if (rows) Object.defineProperty(process.stdout, 'rows', rows);
    else Reflect.deleteProperty(process.stdout, 'rows');
  }
});
