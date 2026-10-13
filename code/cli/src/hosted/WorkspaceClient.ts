import type { HostedSession } from './HostedSession.js';

export interface BridgeTicket {
  url: string;
  ticket: string;
  expiresIn: number;
}

/** Machine workspace access shares the hosted session's refresh lock and origin. */
export class WorkspaceClient {
  constructor(
    readonly session: Pick<HostedSession, 'client' | 'access'>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const response = await this.fetcher(`${this.session.client.origin}/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.session.access()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok)
      throw new Error(
        `Workspace request failed (${response.status}).${response.status === 403 ? ' Run outfitter login --workspaces.' : ''}`,
      );
    return response.json();
  }
  workspace(id: string, action = ''): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid workspace ID.');
    return `workspaces/${id}${action ? `/${action}` : ''}`;
  }
  async ticket(id: string, installation: string, role: 'host' | 'terminal'): Promise<BridgeTicket> {
    const ticket = (await this.request(this.workspace(id, 'bridge-ticket'), 'POST', {
      installation,
      role,
    })) as BridgeTicket;
    const url = new URL(ticket.url);
    if (
      !['wss:', 'ws:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/bridge'
    )
      throw new Error('Invalid workspace bridge URL.');
    if (url.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
      throw new Error('Workspace bridge requires TLS.');
    return ticket;
  }
}
