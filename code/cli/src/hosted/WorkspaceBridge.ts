import { setTimeout as delay } from 'node:timers/promises';
import type { WorkspaceClient } from './WorkspaceClient.js';

export interface BridgeOptions {
  id: string;
  installation: string;
  serviceURL?: string;
  capability?: string;
  terminal?: boolean;
  signal: AbortSignal;
  output?: (data: Buffer) => void;
  ready?: () => void;
}
interface Frame {
  type: string;
  id: string;
  path: string;
  method: string;
  data: string;
  body: string;
}
type Requests = Map<string, AbortController>;
type Send = (value: unknown) => void;

export function callbackOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('The local task service must be a loopback HTTP origin.');
  return url.origin;
}
function callbackURL(frame: Frame, origin: string): URL {
  const valid = [
    typeof frame.id === 'string',
    typeof frame.path === 'string',
    typeof frame.path === 'string' && frame.path.startsWith('/') && !frame.path.startsWith('//'),
    !/[\\\r\n]|%2e|%5c|\/\.\.?(?:\/|$)/i.test(frame.path),
    ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(frame.method),
  ];
  if (!valid.every(Boolean)) throw new Error('Invalid callback');
  const url = new URL(frame.path, origin);
  if (url.origin !== origin) throw new Error('Invalid callback origin');
  return url;
}
async function streamBody(
  response: Response,
  socket: WebSocket,
  controller: AbortController,
  id: string,
  send: Send,
): Promise<void> {
  if (!response.body) return;
  for await (const data of response.body) {
    const buffer = Buffer.from(data);
    for (let offset = 0; offset < buffer.length; offset += 65536) {
      while (socket.bufferedAmount > 1024 * 1024 && socket.readyState === WebSocket.OPEN && !controller.signal.aborted)
        await delay(10);
      if (controller.signal.aborted || socket.readyState !== WebSocket.OPEN) throw new Error('Disconnected');
      send({ type: 'chunk', id, data: buffer.subarray(offset, offset + 65536).toString('base64') });
    }
  }
}
async function forwardCallback(
  frame: Frame,
  socket: WebSocket,
  requests: Requests,
  options: BridgeOptions,
  origin: string,
  send: Send,
): Promise<void> {
  if (requests.size >= 32 || requests.has(frame.id)) throw new Error('Callback capacity exceeded');
  const url = callbackURL(frame, origin);
  const body = Buffer.from(frame.body || '', 'base64');
  if (body.length > 8 * 1024 * 1024) throw new Error('Callback too large');
  const controller = new AbortController();
  requests.set(frame.id, controller);
  try {
    const response = await fetch(url, {
      method: frame.method,
      headers: { Authorization: `Bearer ${options.capability}`, 'Content-Type': 'application/json' },
      body: ['GET', 'HEAD'].includes(frame.method) ? undefined : body,
      redirect: 'error',
      signal: controller.signal,
    });
    send({ type: 'head', id: frame.id, status: response.status, contentType: response.headers.get('content-type') });
    await streamBody(response, socket, controller, frame.id, send);
    send({ type: 'end', id: frame.id });
  } catch {
    send({ type: 'error', id: frame.id });
  } finally {
    requests.delete(frame.id);
  }
}

/** Reconnect transport only. In-flight callbacks and terminal input are never replayed. */
export async function connectWorkspace(client: WorkspaceClient, options: BridgeOptions): Promise<void> {
  const origin = options.terminal ? undefined : callbackOrigin(options.serviceURL || '');
  if (!options.terminal && !options.capability?.startsWith('ptc1.'))
    throw new Error('A task-scoped Panopticon capability is required.');
  let first = true;
  while (!options.signal.aborted) {
    const ticket = await client.ticket(options.id, options.installation, options.terminal ? 'terminal' : 'host');
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(ticket.url);
      const requests: Requests = new Map();
      const send: Send = (value) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
      };
      const input = (data: Buffer) => send({ type: 'input', data: data.toString('base64') });
      const resize = () =>
        send({ type: 'resize', columns: process.stdout.columns || 80, rows: process.stdout.rows || 24 });
      const abort = () => socket.close();
      options.signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('open', () =>
        send({ ticket: ticket.ticket, workspace: `ws-${options.id}`, installation: options.installation }),
      );
      const onReady = () => {
        if (first) {
          first = false;
          options.ready?.();
        }
        if (options.terminal) {
          process.stdin.on('data', input);
          process.stdout.on('resize', resize);
          resize();
        }
      };
      const receive = async (event: MessageEvent): Promise<void> => {
        const frame = JSON.parse(String(event.data)) as Frame;
        if (frame.type === 'ready') {
          onReady();
          return;
        }
        if (options.terminal) {
          if (frame.type === 'output') options.output?.(Buffer.from(frame.data, 'base64'));
          return;
        }
        if (frame.type === 'cancel') {
          requests.get(frame.id)?.abort();
          return;
        }
        if (frame.type !== 'request' || !origin) throw new Error('Invalid callback frame');
        await forwardCallback(frame, socket, requests, options, origin, send);
      };
      socket.addEventListener('message', (event) => {
        void receive(event).catch(() => socket.close(1008, 'Invalid frame'));
      });
      socket.addEventListener('error', () => {
        if (first) reject(new Error('Workspace bridge unavailable.'));
      });
      socket.addEventListener('close', () => {
        options.signal.removeEventListener('abort', abort);
        process.stdin.off('data', input);
        process.stdout.off('resize', resize);
        for (const controller of requests.values()) controller.abort();
        if (first) reject(new Error('Workspace bridge authorization failed.'));
        else resolve();
      });
    });
    if (!options.signal.aborted) await delay(500, undefined, { signal: options.signal }).catch(() => undefined);
  }
}
