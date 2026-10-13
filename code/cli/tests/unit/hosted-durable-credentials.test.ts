import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  persistPiAuth,
  recordedWritebackBaseline,
  seedPiCredentials,
} from '../../src/agents/PiCredentialPersistence.js';
import { durableCredential, durableRefresh, forgetDurable } from '../../src/hosted/DurableCredentials.js';
import { HostedClient } from '../../src/hosted/HostedClient.js';

const ORIGIN = 'https://ai-outfitter.com';
const dirs: string[] = [];
const dir = () => {
  const path = mkdtempSync(join(tmpdir(), 'outfitter-durable-'));
  dirs.push(path);
  return path;
};
afterEach(() => dirs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
const oauth = (refresh: string, expires: number, origin = ORIGIN) => ({
  type: 'oauth',
  access: `${refresh}-access`,
  refresh,
  expires,
  origin,
});
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, { refresh?: string }>;
const rotating = () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, init) =>
    Promise.resolve(
      Response.json({
        access_token: 'next-access',
        refresh_token: `${new URLSearchParams(init?.body as string).get('refresh_token')}+1`,
        expires_in: 900,
      }),
    ),
  );
  return { fetch, client: new HostedClient({ fetch }) };
};

describe('durable Outfitter refresh', () => {
  it.each([
    ['unknown source', { source: 'other', digest: 'some-digest' }],
    ['invalid digest', { source: 'login', digest: 42 }],
  ])('ignores malformed run-local write-back metadata with %s', (_name, baseline) => {
    expect(recordedWritebackBaseline({ outfitterWritebackBaseline: baseline })).toBeUndefined();
  });

  it('rotates the durable refresh token, not a stale copy, and records the result', async () => {
    const path = join(dir(), 'auth.json');
    writeFileSync(path, JSON.stringify({ outfitter: oauth('r1', 0), openai: { type: 'api_key', key: 'byok' } }));
    const { client, fetch } = rotating();
    const next = await durableRefresh(client, path)({ access: 'a', refresh: 'r1', expires: 0, origin: ORIGIN });
    expect(next).toMatchObject({ access: 'next-access', refresh: 'r1+1', origin: ORIGIN });
    expect(fetch).toHaveBeenCalledOnce();
    expect(read(path)).toMatchObject({ outfitter: { refresh: 'r1+1', type: 'oauth' }, openai: { key: 'byok' } });
  });
  it('adopts a rotation another session already made instead of reusing a replaced token', async () => {
    const path = join(dir(), 'auth.json');
    writeFileSync(path, JSON.stringify({ outfitter: oauth('r2', Date.now() + 60000) }));
    const { client, fetch } = rotating();
    const next = await durableRefresh(client, path)({ access: 'a', refresh: 'r1', expires: 0, origin: ORIGIN });
    expect(next).toMatchObject({ access: 'r2-access', refresh: 'r2', origin: ORIGIN });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rotates the newer durable token when it has expired too', async () => {
    const path = join(dir(), 'auth.json');
    writeFileSync(path, JSON.stringify({ outfitter: oauth('r2', 0) }));
    const { client } = rotating();
    expect(
      await durableRefresh(client, path)({ access: 'a', refresh: 'r1', expires: 0, origin: ORIGIN }),
    ).toMatchObject({
      refresh: 'r2+1',
    });
  });
  it.each([
    ['no durable file', undefined],
    ['an empty durable file', ''],
    ['another origin', JSON.stringify({ outfitter: oauth('x', Date.now() + 60000, 'http://localhost:4390') })],
  ])('refreshes this copy and records it with %s', async (_name, contents) => {
    const path = join(dir(), 'auth.json');
    if (contents !== undefined) writeFileSync(path, contents);
    const { client } = rotating();
    await durableRefresh(client, path)({ access: 'a', refresh: 'r1', expires: 0, origin: ORIGIN });
    expect(read(path).outfitter.refresh).toBe('r1+1');
  });
  it('refuses to refresh while a logout is pending', async () => {
    const path = join(dir(), 'auth.json');
    writeFileSync(path, JSON.stringify({ outfitter: { ...oauth('r1', 0), pendingRevocation: true } }));
    const { client, fetch } = rotating();
    await expect(
      durableRefresh(client, path)({ access: 'a', refresh: 'r1', expires: 0, origin: ORIGIN }),
    ).rejects.toThrow('logout is pending');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reads and forgets only matching durable credentials', () => {
    const path = join(dir(), 'auth.json');
    const client = new HostedClient();
    expect(durableCredential(client, path)).toBeUndefined();
    writeFileSync(path, JSON.stringify({ outfitter: oauth('r1', 1, 'http://localhost:4390') }));
    expect(durableCredential(client, path)).toBeUndefined();
    writeFileSync(path, JSON.stringify({ outfitter: oauth('r1', 1) }));
    expect(durableCredential(client, path)).toEqual({ access: 'r1-access', refresh: 'r1', expires: 1, origin: ORIGIN });
    forgetDurable(path, [{ access: 'x', refresh: 'other', expires: 0 }]);
    expect(read(path).outfitter).toBeDefined();
    forgetDurable(path, [{ access: 'x', refresh: 'r1', expires: 0 }]);
    expect(read(path)).toEqual({});
    forgetDurable(path, [{ access: 'x', refresh: 'r1', expires: 0 }]);
  });
});

describe('Pi credential write-back with a rotating Outfitter token', () => {
  const setup = (durable: Record<string, unknown>) => {
    const user = join(dir(), 'agent');
    mkdirSync(user, { recursive: true });
    writeFileSync(join(user, 'auth.json'), JSON.stringify(durable));
    return { user, path: join(user, 'auth.json') };
  };
  const run = (user: string) => {
    const root = dir();
    const baseline = seedPiCredentials(root, user);
    return {
      baseline,
      // What Pi left in the run's auth.json when it exited.
      exit: (state: Record<string, unknown>) => {
        writeFileSync(join(root, 'auth.json'), JSON.stringify(state));
        return persistPiAuth(root, user, baseline);
      },
      exitWith: (text: string) => {
        writeFileSync(join(root, 'auth.json'), text);
        return persistPiAuth(root, user, baseline);
      },
    };
  };
  it('keeps a rotation another run made while this run held the older token', async () => {
    const { user, path } = setup({ outfitter: oauth('r1', 100) });
    const first = run(user);
    // Another run refreshed through the durable file after this one was seeded.
    writeFileSync(path, JSON.stringify({ outfitter: oauth('r2', 50) }));
    await first.exit({ outfitter: oauth('r1', 100), anthropic: { type: 'api_key', key: 'new' } });
    expect(read(path)).toEqual({ outfitter: oauth('r2', 50), anthropic: { type: 'api_key', key: 'new' } });
  });
  it('keeps a logout another run made while this run held the credential', async () => {
    const { user, path } = setup({ outfitter: oauth('r1', 100), openai: { type: 'api_key', key: 'byok' } });
    const first = run(user);
    // `outfitter logout` revoked the session and removed the durable entry.
    writeFileSync(path, JSON.stringify({ openai: { type: 'api_key', key: 'byok' } }));
    await first.exit({ outfitter: oauth('r1', 100), openai: { type: 'api_key', key: 'byok' } });
    expect(read(path)).toEqual({ openai: { type: 'api_key', key: 'byok' } });
  });
  it('waits for a refresh holding the lock instead of overwriting its rotation', async () => {
    const { user, path } = setup({ outfitter: oauth('r1', 0) });
    const exiting = run(user);
    let release!: () => void;
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      await answered;
      return Response.json({ access_token: 'r2-access', refresh_token: 'r2', expires_in: 900 });
    });
    // Another run's refresh holds Pi's lock across its network call.
    const refreshing = durableRefresh(
      new HostedClient({ fetch }),
      path,
    )({
      access: 'a',
      refresh: 'r1',
      expires: 0,
      origin: ORIGIN,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const persisting = exiting.exit({ outfitter: oauth('r1', 0), anthropic: { type: 'api_key', key: 'k' } });
    release();
    await Promise.all([refreshing, persisting]);
    expect(read(path)).toMatchObject({ outfitter: { refresh: 'r2' }, anthropic: { key: 'k' } });
  });
  it('writes this run’s own sign-in, rotation and logout when nobody else changed the entry', async () => {
    const { user, path } = setup({ anthropic: { type: 'api_key', key: 'k' } });
    const signedIn = run(user);
    await signedIn.exit({ anthropic: { type: 'api_key', key: 'k' }, outfitter: oauth('mine', 300) });
    expect(read(path).outfitter.refresh).toBe('mine');
    const rotated = run(user);
    await rotated.exit({ outfitter: oauth('mine+1', 400) });
    expect(read(path)).toEqual({ outfitter: oauth('mine+1', 400) });
    const loggedOut = run(user);
    await loggedOut.exit({ anthropic: { type: 'api_key', key: 'k2' } });
    expect(read(path)).toEqual({ anthropic: { type: 'api_key', key: 'k2' } });
  });
  it('keeps another run’s sign-in when this run had none and changed nothing', async () => {
    const { user, path } = setup({});
    const first = run(user);
    expect(first.baseline).toEqual({ hosted: undefined });
    writeFileSync(path, JSON.stringify({ outfitter: oauth('other', 100) }));
    await first.exit({ anthropic: { type: 'api_key', key: 'k' } });
    expect(read(path)).toEqual({ outfitter: oauth('other', 100), anthropic: { type: 'api_key', key: 'k' } });
  });
  it('treats key order as the same credential', async () => {
    const { user, path } = setup({ outfitter: oauth('r1', 100) });
    const first = run(user);
    writeFileSync(
      path,
      JSON.stringify({
        outfitter: { origin: ORIGIN, expires: 100, refresh: 'r1', access: 'r1-access', type: 'oauth' },
      }),
    );
    await first.exit({ outfitter: oauth('r2', 200) });
    expect(read(path).outfitter.refresh).toBe('r2');
  });
  it('falls back to a plain copy when either file is unreadable', async () => {
    const { user, path } = setup({});
    writeFileSync(path, 'not json');
    const first = run(user);
    expect(first.baseline).toEqual({ hosted: undefined });
    await first.exit({ outfitter: oauth('mine', 1) });
    expect(read(path).outfitter.refresh).toBe('mine');
    await first.exitWith('{broken');
    expect(readFileSync(path, 'utf8')).toBe('{broken');
    // An empty durable file is an empty store, not an unreadable one.
    writeFileSync(path, '');
    await first.exit({ anthropic: { type: 'api_key', key: 'k' } });
    expect(read(path)).toEqual({ anthropic: { type: 'api_key', key: 'k' } });
    writeFileSync(path, '[]');
    await first.exit({ outfitter: oauth('mine', 1) });
    expect(read(path).outfitter.refresh).toBe('mine');
  });
  it('treats a write-back without a baseline as seeded with no Outfitter credential', async () => {
    const { user, path } = setup({ outfitter: oauth('other', 100) });
    const root = dir();
    writeFileSync(join(root, 'auth.json'), JSON.stringify({ anthropic: { type: 'api_key', key: 'k' } }));
    await persistPiAuth(root, user);
    expect(read(path)).toEqual({ anthropic: { type: 'api_key', key: 'k' }, outfitter: oauth('other', 100) });
  });
});
