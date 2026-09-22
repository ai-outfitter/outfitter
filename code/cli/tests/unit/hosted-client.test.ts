import { describe, it, expect, vi } from 'vitest';
import { HostedClient, hostedOrigin } from '../../src/hosted/HostedClient.js';
import type { Credentials, HostedOAuth } from '../../src/hosted/HostedClient.js';

const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 60 };
const device = {
  device_code: 'private-code',
  user_code: 'ABC',
  verification_uri: 'https://ai-outfitter.com/device',
  expires_in: 600,
  interval: 5,
};
const callbacks = (): Parameters<HostedOAuth['login']>[0] => ({
  onDeviceCode: vi.fn(),
  onAuth: vi.fn(),
  onPrompt: vi.fn(),
  onSelect: vi.fn(),
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const model = {
  id: 'public/model',
  name: 'Public model',
  context_length: 8000,
  max_output_tokens: 1024,
  pricing: { prompt: '0.000001', completion: '0.000003' },
};

const fixture = (responses: Response[]) => {
  let time = 0;
  const sleep = vi.fn((ms: number) => {
    time += ms;
    return Promise.resolve();
  });
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!));
  const client = new HostedClient({ fetch, now: () => time, sleep });
  return { client, fetch, sleep };
};

describe('hosted authentication boundary', () => {
  it('permits HTTPS and loopback, rejecting remote HTTP and credential-bearing origins', () => {
    expect(hostedOrigin()).toBe('https://ai-outfitter.com');
    expect(hostedOrigin('http://127.0.0.1:8123')).toBe('http://127.0.0.1:8123');
    expect(hostedOrigin('http://localhost')).toBe('http://localhost');
    expect(hostedOrigin('http://[::1]')).toBe('http://[::1]');
    for (const origin of [
      'http://example.com',
      'https://a:b@example.com',
      'https://example.com/path',
      'https://example.com/?x=1',
      'https://example.com/#x',
      'file:///',
    ])
      expect(() => hostedOrigin(origin)).toThrow();
  });
  it('uses an abortable native timer between device polls', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ ...device, interval: 0.001 }))
      .mockResolvedValueOnce(response(tokens));
    const client = new HostedClient({ fetch });
    expect(await client.login(callbacks())).toMatchObject({ access: 'access' });
  });
  it('polls browser approval with slow-down and binds credentials to their issuing origin', async () => {
    const { client, sleep, fetch } = fixture([
      response(device),
      response({ error: 'authorization_pending' }, 400),
      response({ error: 'slow_down' }, 400),
      response(tokens),
    ]);
    const cb = callbacks();
    const credentials = await client.oauth().login(cb);
    expect(credentials).toEqual({
      access: 'access',
      refresh: 'refresh',
      expires: 80000,
      origin: 'https://ai-outfitter.com',
    });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000, 5000, 10000]);
    expect(cb.onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'ABC' }));
    expect(client.oauth().getApiKey(credentials)).toBe('access');
    expect(fetch.mock.calls[0][1]?.redirect).toBe('error');
    expect(() => client.oauth().getApiKey({ ...credentials, origin: 'https://other.test' })).toThrow('another origin');
  });
  it('discovers models after native Pi login and refreshes credentials', async () => {
    const { client } = fixture([response(device), response(tokens), response(tokens)]);
    const after = vi.fn<(credentials: Credentials) => Promise<void>>().mockResolvedValue();
    const credential = await client.oauth(after).login(callbacks());
    expect(after).toHaveBeenCalledWith(credential);
    expect(await client.oauth().refreshToken(credential)).toMatchObject({ access: 'access', origin: client.origin });
  });
  it.each([
    [response({}, 503), 'unavailable'],
    [response({ ...device, interval: 0 }), 'Invalid'],
    [response({ ...device, expires_in: -1 }), 'Invalid'],
    [response({ ...device, device_code: '' }), 'Invalid'],
    [response({ ...device, user_code: '' }), 'Invalid'],
    [response({ ...device, verification_uri: 'https://attacker.example' }), 'Unexpected'],
  ])('rejects invalid device enrollment %#', async (first, message) => {
    await expect(fixture([first]).client.login(callbacks())).rejects.toThrow(message);
  });
  it('expires without polling beyond the device lifetime', async () => {
    const { client, fetch } = fixture([response({ ...device, expires_in: 1 })]);
    await expect(client.login(callbacks())).rejects.toThrow('expired');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects denied approval and invalid token responses', async () => {
    await expect(
      fixture([response(device), response({ error: 'access_denied' }, 403)]).client.login(callbacks()),
    ).rejects.toThrow('denied');
    for (const invalid of [
      { ...tokens, expires_in: 0 },
      { ...tokens, access_token: '' },
      { ...tokens, refresh_token: '' },
    ])
      await expect(fixture([response(device), response(invalid)]).client.login(callbacks())).rejects.toThrow('Invalid');
  });
  it('cancels device enrollment and bounds every request', async () => {
    const controller = new AbortController();
    const { client, fetch } = fixture([response(device), response(tokens)]);
    await client.login({ ...callbacks(), signal: controller.signal });
    expect(fetch.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('never sends refresh credentials to a different origin', async () => {
    const { client, fetch } = fixture([]);
    await expect(
      client.refreshToken({ access: 'a', refresh: 'r', expires: 0, origin: 'https://elsewhere.example' }),
    ).rejects.toThrow('another origin');
    expect(fetch).not.toHaveBeenCalled();
    const denied = fixture([response({}, 401)]).client;
    await expect(denied.refreshToken({ access: 'a', refresh: 'r', expires: 0, origin: denied.origin })).rejects.toThrow(
      'session expired',
    );
  });
  it('maps entitled models to native Pi OpenAI streaming with tool support', async () => {
    const { client, fetch } = fixture([response({ data: [model] })]);
    const models = await client.models('secret');
    expect(models[0]).toMatchObject({
      id: model.id,
      contextWindow: 8000,
      maxTokens: 1024,
      cost: { input: 1, output: 3 },
    });
    expect(client.provider(models)).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://ai-outfitter.com/v1',
      models,
    });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });
  it('uses explicit methods, accepts logout 204, and redacts server error bodies', async () => {
    const { client, fetch } = fixture([response({}, 403), new Response(null, { status: 204 }), response({ ok: true })]);
    await expect(client.api('/denied', 'a')).rejects.toThrow('(403)');
    expect(await client.api('/api/cli/logout', 'a', {}, 'POST')).toBeUndefined();
    await client.api('/api/cli/workspace', 'a', { workspace_id: 'org:2' }, 'PUT');
    expect(fetch.mock.calls[2][1]?.method).toBe('PUT');
  });
});
