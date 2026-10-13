import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import { installPiLogout } from '../../src/hosted/PiLogout.js';
import { markPendingRevocation } from '../../src/hosted/DurableCredentials.js';
import { persistPiAuth, seedPiCredentials } from '../../src/agents/PiCredentialPersistence.js';

const credential = {
  type: 'oauth' as const,
  access: 'a',
  refresh: 'r',
  expires: 0,
  origin: 'https://ai-outfitter.com',
};
describe('native Pi logout revocation', () => {
  it('starts remote revocation and only removes credentials after success', async () => {
    const auth = AuthStorage.inMemory({ outfitter: credential, openai: { type: 'api_key', key: 'byok' } });
    let complete!: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const notify = vi.fn();
    installPiLogout(auth, new HostedClient({ fetch }), notify);
    auth.logout('outfitter');
    expect(fetch).toHaveBeenCalledOnce();
    expect(auth.get('outfitter')).toMatchObject({ pendingRevocation: true });
    expect(fetch.mock.calls[0][0]).toBe('https://ai-outfitter.com/api/oauth/revoke');
    complete(new Response(null, { status: 200 }));
    await vi.waitFor(() => expect(auth.get('outfitter')).toBeUndefined());
    expect(notify).toHaveBeenCalledWith('Outfitter session revoked.', 'info');
    expect(auth.get('openai')).toBeDefined();
    auth.logout('openai');
    expect(auth.get('openai')).toBeUndefined();
    auth.logout('outfitter');
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('retains failed revocations and retries their durable marker on startup', async () => {
    const auth = AuthStorage.inMemory({ outfitter: { ...credential, pendingRevocation: true } });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 503 }));
    const notify = vi.fn();
    installPiLogout(auth, new HostedClient({ fetch }), notify);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining('failed'), 'error'));
    expect(auth.get('outfitter')).toMatchObject({ pendingRevocation: true });
  });
  it('also revokes and forgets the durable copy a per-run session was seeded from', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outfitter-pi-logout-'));
    try {
      const durablePath = join(dir, 'auth.json');
      // Another run rotated the session since this copy was seeded.
      writeFileSync(
        durablePath,
        JSON.stringify({ outfitter: { ...credential, refresh: 'r2' }, openai: { type: 'api_key', key: 'byok' } }),
      );
      const auth = AuthStorage.inMemory({ outfitter: credential });
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }));
      const notify = vi.fn();
      installPiLogout(auth, new HostedClient({ fetch }), notify, durablePath);
      auth.logout('outfitter');
      await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('Outfitter session revoked.', 'info'));
      expect(fetch.mock.calls.map(([, init]) => new URLSearchParams(init?.body as string).get('token'))).toEqual([
        'r',
        'r2',
      ]);
      expect(JSON.parse(readFileSync(durablePath, 'utf8'))).toEqual({ openai: { type: 'api_key', key: 'byok' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  describe('when Pi exits before the server answers', () => {
    const dirs: string[] = [];
    const tmp = () => {
      const path = mkdtempSync(join(tmpdir(), 'outfitter-pi-exit-'));
      dirs.push(path);
      return path;
    };
    const cleanup = () => dirs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, Record<string, unknown>>;
    // One Outfitter run: Pi works on a per-run copy seeded from the durable agent directory.
    const start = (agent: string) => {
      const root = tmp();
      const baseline = seedPiCredentials(root, agent);
      const auth = AuthStorage.create(join(root, 'auth.json'));
      return { auth, exit: () => persistPiAuth(root, agent, baseline) };
    };
    it('records the pending revocation durably before logout returns and retries it at the next start', async () => {
      try {
        const agent = tmp();
        const durablePath = join(agent, 'auth.json');
        writeFileSync(durablePath, JSON.stringify({ outfitter: credential, openai: { type: 'api_key', key: 'byok' } }));
        const first = start(agent);
        const hung = vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise(() => undefined));
        const notify = vi.fn();
        installPiLogout(first.auth, new HostedClient({ fetch: hung }), notify, durablePath);
        first.auth.logout('outfitter');
        // Synchronously, before the revocation request has an answer.
        expect(read(durablePath).outfitter).toMatchObject({ refresh: 'r', pendingRevocation: true });
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('sign-out pending'), 'info');
        expect(notify).not.toHaveBeenCalledWith('Outfitter session revoked.', 'info');
        // Pi exits now; the write-back keeps the marker rather than the run's earlier copy.
        await first.exit();
        expect(read(durablePath)).toMatchObject({
          outfitter: { refresh: 'r', pendingRevocation: true },
          openai: { key: 'byok' },
        });

        const second = start(agent);
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 200 }));
        const retried = vi.fn();
        installPiLogout(second.auth, new HostedClient({ fetch }), retried, durablePath);
        await vi.waitFor(() => expect(retried).toHaveBeenCalledWith('Outfitter session revoked.', 'info'));
        expect(new URLSearchParams(fetch.mock.calls[0][1]?.body as string).get('token')).toBe('r');
        await second.exit();
        // Revoked and gone, and neither run's write-back brings it back.
        expect(read(durablePath)).toEqual({ openai: { type: 'api_key', key: 'byok' } });
        await first.exit();
        expect(read(durablePath)).toEqual({ openai: { type: 'api_key', key: 'byok' } });
      } finally {
        cleanup();
      }
    });
    it('marks a credential signed in during this run, which the durable file never had', async () => {
      try {
        const agent = tmp();
        const durablePath = join(agent, 'auth.json');
        const run = start(agent);
        run.auth.set('outfitter', credential);
        installPiLogout(
          run.auth,
          new HostedClient({ fetch: vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise(() => undefined)) }),
          vi.fn(),
          durablePath,
        );
        run.auth.logout('outfitter');
        await run.exit();
        expect(read(durablePath).outfitter).toMatchObject({ type: 'oauth', refresh: 'r', pendingRevocation: true });
      } finally {
        cleanup();
      }
    });
    it('marks a newer rotation of this origin, and leaves another origin’s sign-in alone', () => {
      try {
        const path = join(tmp(), 'auth.json');
        writeFileSync(path, JSON.stringify({ outfitter: { ...credential, refresh: 'r2' } }));
        markPendingRevocation(path, credential);
        expect(read(path).outfitter).toMatchObject({ refresh: 'r2', pendingRevocation: true });
        const other = { ...credential, origin: 'http://localhost:4390' };
        writeFileSync(path, JSON.stringify({ outfitter: other }));
        markPendingRevocation(path, credential);
        expect(read(path)).toEqual({ outfitter: other });
        writeFileSync(path, JSON.stringify({ outfitter: { type: 'api_key', key: 'manual' } }));
        markPendingRevocation(path, credential);
        expect(read(path)).toEqual({ outfitter: { type: 'api_key', key: 'manual' } });
      } finally {
        cleanup();
      }
    });
    it('says so when the pending revocation cannot be saved', () => {
      try {
        const blocked = join(tmp(), 'file');
        mkdirSync(join(blocked, '..'), { recursive: true });
        writeFileSync(blocked, 'not a directory');
        const auth = AuthStorage.inMemory({ outfitter: credential });
        const notify = vi.fn();
        installPiLogout(
          auth,
          new HostedClient({ fetch: vi.fn<typeof globalThis.fetch>().mockReturnValue(new Promise(() => undefined)) }),
          notify,
          join(blocked, 'auth.json'),
        );
        auth.logout('outfitter');
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('could not be saved'), 'error');
        expect(auth.get('outfitter')).toMatchObject({ pendingRevocation: true });
      } finally {
        cleanup();
      }
    });
  });
});
