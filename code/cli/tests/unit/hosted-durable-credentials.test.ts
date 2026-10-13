import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistPiCredentials, seedPiCredentials } from '../../src/agents/PiCredentialPersistence.js';
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
        refresh_token: `${(JSON.parse(init?.body as string) as { refresh_token: string }).refresh_token}+1`,
        expires_in: 900,
      }),
    ),
  );
  return { fetch, client: new HostedClient({ fetch }) };
};

describe('durable Outfitter refresh', () => {
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
  const setup = () => {
    const user = join(dir(), 'agent');
    mkdirSync(user, { recursive: true });
    return { user, first: dir(), second: dir() };
  };
  it('keeps the newer rotation when an older run exits last', () => {
    const { user, first, second } = setup();
    writeFileSync(join(user, 'auth.json'), JSON.stringify({ outfitter: oauth('r1', 100) }));
    seedPiCredentials(first, user);
    seedPiCredentials(second, user);
    // The second run rotated through the durable file; the first exits later with its stale copy.
    writeFileSync(join(user, 'auth.json'), JSON.stringify({ outfitter: oauth('r2', 200) }));
    writeFileSync(join(second, 'auth.json'), JSON.stringify({ outfitter: oauth('r2', 200) }));
    persistPiCredentials(second, user);
    writeFileSync(
      join(first, 'auth.json'),
      JSON.stringify({ outfitter: oauth('r1', 100), anthropic: { type: 'api_key', key: 'new' } }),
    );
    persistPiCredentials(first, user);
    expect(read(join(user, 'auth.json'))).toMatchObject({ outfitter: { refresh: 'r2' }, anthropic: { key: 'new' } });
  });
  it('keeps another run sign-in, and takes this run newer one', () => {
    const { user, first } = setup();
    writeFileSync(join(user, 'auth.json'), JSON.stringify({ outfitter: oauth('other', 100) }));
    writeFileSync(join(first, 'auth.json'), JSON.stringify({ anthropic: { type: 'api_key', key: 'k' } }));
    persistPiCredentials(first, user);
    expect(read(join(user, 'auth.json')).outfitter.refresh).toBe('other');
    writeFileSync(join(first, 'auth.json'), JSON.stringify({ outfitter: oauth('mine', 300) }));
    persistPiCredentials(first, user);
    expect(read(join(user, 'auth.json')).outfitter.refresh).toBe('mine');
    writeFileSync(join(first, 'auth.json'), JSON.stringify({ outfitter: { type: 'api_key', key: 'manual' } }));
    persistPiCredentials(first, user);
    expect(read(join(user, 'auth.json')).outfitter).toEqual({ type: 'api_key', key: 'manual' });
  });
  it('falls back to a plain copy when either file is unreadable', () => {
    const { user, first } = setup();
    writeFileSync(join(user, 'auth.json'), 'not json');
    writeFileSync(join(first, 'auth.json'), JSON.stringify({ outfitter: oauth('mine', 1) }));
    persistPiCredentials(first, user);
    expect(read(join(user, 'auth.json')).outfitter.refresh).toBe('mine');
    writeFileSync(join(first, 'auth.json'), '{broken');
    persistPiCredentials(first, user);
    expect(readFileSync(join(user, 'auth.json'), 'utf8')).toBe('{broken');
  });
});
