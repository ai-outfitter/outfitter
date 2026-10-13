import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import { WorkspaceClient } from '../../src/hosted/WorkspaceClient.js';
import { callbackOrigin, connectWorkspace } from '../../src/hosted/WorkspaceBridge.js';
import { createWorkspaceCommand } from '../../src/cli/commands/WorkspaceCommand.js';

const id = '11111111-1111-4111-8111-111111111111';
const installation = '22222222-2222-4222-8222-222222222222';
const session = { client: new HostedClient(), access: () => Promise.resolve('short-lived-access') };
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('machine workspace client', () => {
  it('uses the hosted origin and access token, with JSON and no redirects', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ state: 'Running' }));
    const client = new WorkspaceClient(session, fetcher);
    expect(await client.request(client.workspace(id), 'PUT', { runtime: 'panopticon' })).toEqual({ state: 'Running' });
    expect(fetcher.mock.calls[0][0]).toBe(`https://ai-outfitter.com/api/workspaces/${id}`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      redirect: 'error',
      headers: { Authorization: 'Bearer short-lived-access' },
    });
    expect(() => client.workspace('../other')).toThrow('Invalid workspace');
  });
  it('requires explicit workspace permission and surfaces API failures', async () => {
    const client = new WorkspaceClient(session, vi.fn().mockResolvedValue(new Response('', { status: 403 })));
    await expect(client.request('workspace-capabilities')).rejects.toThrow('login --workspaces');
  });
  it.each([
    'ws://public.example/bridge',
    'wss://example/other',
    'wss://user:secret@example/bridge',
    'wss://example/bridge?token=secret',
    'wss://example/bridge#secret',
    'https://example/bridge',
  ])('refuses unsafe bridge URLs: %s', async (url) => {
    const client = new WorkspaceClient(session, vi.fn().mockResolvedValue(Response.json({ url, ticket: 'one-use' })));
    await expect(client.ticket(id, installation, 'host')).rejects.toThrow();
  });
  it('surfaces quota failures without suggesting a new authorization grant', async () => {
    const client = new WorkspaceClient(session, vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(client.request('workspace-capabilities')).rejects.toThrow('Workspace request failed (429).');
  });
  it('accepts encrypted bridge endpoints and loopback test endpoints', async () => {
    for (const url of ['wss://workspaces.example/bridge', 'ws://127.0.0.1:9000/bridge']) {
      const client = new WorkspaceClient(
        session,
        vi.fn().mockResolvedValue(Response.json({ url, ticket: 'one-use', expiresIn: 30 })),
      );
      expect((await client.ticket(id, installation, 'host')).ticket).toBe('one-use');
    }
  });
});

describe('workspace commands', () => {
  it('keeps operations machine-readable and sends session data through stdin', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json({ ok: true })));
    const client = new WorkspaceClient(session, fetcher);
    const print = vi.fn();
    for (const args of [
      ['capabilities'],
      ['create', id],
      ['inspect', id],
      ['session-status', id],
      ['session-transcript', id],
      ['session', id],
      ['sleep', id],
      ['wake', id],
      ['expire', id],
      ['close', id],
    ]) {
      const program = new Command();
      createWorkspaceCommand({
        client: () => client,
        print,
        readInput: () => JSON.stringify({ operation: 'bind', task: 'task-id' }),
      }).register(program);
      await program.parseAsync(['workspaces', ...args], { from: 'user' });
    }
    expect(print).toHaveBeenCalledTimes(10);
    const bodies = fetcher.mock.calls
      .map(([, init]) => init?.body)
      .filter(Boolean)
      .map((body) => JSON.parse(body as string) as unknown);
    expect(bodies).toContainEqual({ operation: 'bind', task: 'task-id' });
    expect(bodies).toContainEqual({ operation: 'close' });
  });
});

describe('outbound callbacks', () => {
  it.each([
    'https://127.0.0.1',
    'http://example.com',
    'http://127.0.0.1/path',
    'http://user:pass@localhost',
    'http://localhost?redirect=other',
    'http://localhost/#fragment',
    'http://:password@localhost',
  ])('refuses a non-fixed local callback destination: %s', (url) => {
    expect(() => callbackOrigin(url)).toThrow('loopback');
  });
  it('streams a callback with only the configured task capability', async () => {
    const controller = new AbortController();
    const outgoing: Record<string, unknown>[] = [];
    class Socket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      bufferedAmount = 0;
      constructor() {
        super();
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(raw: string) {
        const frame = JSON.parse(raw) as Record<string, unknown>;
        outgoing.push(frame);
        if (frame.ticket) {
          queueMicrotask(() => {
            this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) }));
            this.dispatchEvent(
              new MessageEvent('message', {
                data: JSON.stringify({
                  type: 'request',
                  id: 'request-1',
                  method: 'PUT',
                  path: '/tasks/own/turn',
                  body: Buffer.from('{"turn":"user"}').toString('base64'),
                }),
              }),
            );
          });
        }
        if (frame.type === 'end') controller.abort();
      }
      close() {
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('streamed response', { headers: { 'Content-Type': 'text/plain' } }));
    vi.stubGlobal('fetch', fetcher);
    const client = {
      ticket: () => Promise.resolve({ url: 'wss://gateway.example/bridge', ticket: 'ticket', expiresIn: 30 }),
    } as unknown as WorkspaceClient;
    await connectWorkspace(client, {
      id,
      installation,
      serviceURL: 'http://127.0.0.1:8000',
      capability: 'ptc1.own.self.mac',
      signal: controller.signal,
    });
    expect(fetcher.mock.calls[0][0]).toEqual(new URL('http://127.0.0.1:8000/tasks/own/turn'));
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: 'Bearer ptc1.own.self.mac' },
    });
    expect(outgoing[0]).toMatchObject({ workspace: `ws-${id}`, installation });
    expect(outgoing.some((frame) => frame.type === 'chunk')).toBe(true);
  });
  it('rejects a fleet token before opening a connection', async () => {
    await expect(
      connectWorkspace({} as WorkspaceClient, {
        id,
        installation,
        serviceURL: 'http://localhost:8000',
        capability: 'fleet-token',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('task-scoped');
  });
});

describe('callback reconnection', () => {
  it('does not replay a mutation after the local service committed but the connection was lost', async () => {
    const { createServer } = await import('node:http');
    let mutations = 0;
    let authorization = '';
    const holder: { socket?: Socket } = {};
    const controller = new AbortController();
    const server = createServer((req, res) => {
      mutations += 1;
      authorization = String(req.headers.authorization);
      req.resume();
      holder.socket?.close();
      res.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    let connections = 0;
    class Socket extends EventTarget {
      static OPEN = 1;
      readyState = 1;
      bufferedAmount = 0;
      constructor() {
        super();
        // Each synthetic transport is retained so the HTTP server can sever it.
        Object.assign(holder, { socket: this });
        connections += 1;
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
      }
      send(raw: string) {
        const frame = JSON.parse(raw) as Record<string, unknown>;
        if (!frame.ticket) return;
        queueMicrotask(() => {
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'ready' }) }));
          if (connections === 1)
            this.dispatchEvent(
              new MessageEvent('message', {
                data: JSON.stringify({
                  type: 'request',
                  id: 'mutation',
                  method: 'POST',
                  path: '/tasks/own/operations/advance',
                  body: '',
                }),
              }),
            );
          else setTimeout(() => controller.abort(), 20);
        });
      }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.dispatchEvent(new Event('close'));
      }
    }
    vi.stubGlobal('WebSocket', Socket);
    const client = {
      ticket: () => Promise.resolve({ url: 'wss://gateway.example/bridge', ticket: 'scoped' }),
    } as unknown as WorkspaceClient;
    try {
      await connectWorkspace(client, {
        id,
        installation,
        serviceURL: `http://127.0.0.1:${address.port}`,
        capability: 'ptc1.own.self.mac',
        signal: controller.signal,
      });
      expect(connections).toBe(2);
      expect(mutations).toBe(1);
      expect(authorization).toBe('Bearer ptc1.own.self.mac');
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
