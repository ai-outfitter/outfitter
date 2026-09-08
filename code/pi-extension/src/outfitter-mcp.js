import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';

const timeoutMs = 10_000;

// Each activation stages fresh clients. Nothing is callable until the controller commits it.
export async function stageMcp(servers, cwd) {
  const clients = [];
  try {
    for (const [server, definition] of Object.entries(servers)) {
      if (
        !definition ||
        typeof definition.command !== 'string' ||
        definition.command.length === 0 ||
        (definition.type !== undefined && definition.type !== 'stdio') ||
        definition.url !== undefined ||
        (definition.args !== undefined &&
          (!Array.isArray(definition.args) || !definition.args.every((arg) => typeof arg === 'string'))) ||
        (definition.env !== undefined &&
          (!definition.env ||
            typeof definition.env !== 'object' ||
            Array.isArray(definition.env) ||
            !Object.values(definition.env).every((value) => typeof value === 'string')))
      ) {
        throw new Error(`MCP server '${server}' requires a valid stdio command, args and environment.`);
      }
      const client = connect(definition, cwd);
      clients.push(client);
      const initialized = await client.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'outfitter', version: '1.0.0' },
      });
      if (!initialized || typeof initialized.protocolVersion !== 'string' || !initialized.capabilities) {
        throw new Error(`MCP server '${server}' returned an invalid initialization.`);
      }
      client.notify('notifications/initialized', {});
      const tools = [];
      const cursors = new Set();
      let cursor;
      do {
        const page = await client.request('tools/list', cursor === undefined ? {} : { cursor });
        if (!page || !Array.isArray(page.tools))
          throw new Error(`MCP server '${server}' returned an invalid tool list.`);
        for (const tool of page.tools) {
          if (typeof tool.name !== 'string' || !tool.name || !tool.inputSchema || tool.inputSchema.type !== 'object') {
            throw new Error(`MCP server '${server}' returned an invalid tool schema.`);
          }
          const name = `mcp_${createHash('sha256')
            .update(JSON.stringify([server, tool.name]))
            .digest('hex')
            .slice(0, 48)}`;
          if (tools.some((entry) => entry.name === name)) throw new Error(`MCP server '${server}' repeated a tool.`);
          tools.push({
            name,
            label: `${server}: ${tool.name}`,
            description: tool.description ?? `${server}: ${tool.name}`,
            parameters: tool.inputSchema,
            execute: async (_id, args, signal) => {
              const result = await client.request('tools/call', { name: tool.name, arguments: args }, signal);
              if (!result || !Array.isArray(result.content)) throw new Error('MCP returned an invalid tool result.');
              return { content: result.content, details: { server, isError: result.isError === true } };
            },
          });
        }
        cursor = page.nextCursor;
        if (cursor !== undefined && (typeof cursor !== 'string' || cursors.has(cursor))) {
          throw new Error(`MCP server '${server}' returned an invalid pagination cursor.`);
        }
        cursors.add(cursor);
      } while (cursor !== undefined);
      client.tools = tools;
    }
    return {
      tools: clients.flatMap((client) => client.tools),
      close: () => clients.forEach((client) => client.close()),
    };
  } catch (error) {
    clients.forEach((client) => client.close());
    throw error;
  }
}

function connect(definition, cwd) {
  const child = spawn(definition.command, definition.args ?? [], {
    cwd,
    env: { ...process.env, ...definition.env },
    stdio: ['pipe', 'pipe', 'ignore'],
    shell: false,
  });
  const pending = new Map();
  let nextId = 0;
  let closed = false;
  const fail = (error) => {
    closed = true;
    for (const request of [...pending.values()]) request.reject(error);
    pending.clear();
  };
  child.on('error', () => fail(new Error('MCP server could not start.')));
  child.on('exit', () => fail(new Error('MCP server exited.')));
  child.stdin.on('error', () => fail(new Error('MCP input stream closed.')));
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(new Error('MCP server returned invalid JSON.'));
      return;
    }
    if (message?.method && message.id !== undefined) {
      child.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unsupported request' } }) +
          '\n',
      );
      return;
    }
    const request = pending.get(message?.id);
    if (request) {
      if (message.error) request.reject(new Error('MCP request failed.'));
      else request.resolve(message.result);
    }
  });
  return {
    request(method, params, signal) {
      if (closed) return Promise.reject(new Error('MCP connection is closed.'));
      if (signal?.aborted) return Promise.reject(new Error('MCP request cancelled.'));
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const finish = (callback, value) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
          pending.delete(id);
          callback(value);
        };
        const cancel = () => finish(reject, new Error('MCP request cancelled.'));
        const timer = setTimeout(() => finish(reject, new Error('MCP request timed out.')), timeoutMs);
        signal?.addEventListener('abort', cancel, { once: true });
        pending.set(id, {
          resolve: (value) => finish(resolve, value),
          reject: (error) => finish(reject, error),
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    notify(method, params) {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    },
    close() {
      fail(new Error('MCP connection closed.'));
      lines.close();
      child.stdin.destroy();
      child.stdout.destroy();
      child.kill('SIGTERM');
      const timer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 1000);
      timer.unref();
      child.once('exit', () => clearTimeout(timer));
    },
  };
}
