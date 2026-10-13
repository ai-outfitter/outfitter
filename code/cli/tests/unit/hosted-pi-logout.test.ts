import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import { installPiLogout } from '../../src/hosted/PiLogout.js';

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
      expect(fetch.mock.calls.map(([, init]) => (JSON.parse(init?.body as string) as { token: string }).token)).toEqual(
        ['r', 'r2'],
      );
      expect(JSON.parse(readFileSync(durablePath, 'utf8'))).toEqual({ openai: { type: 'api_key', key: 'byok' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
