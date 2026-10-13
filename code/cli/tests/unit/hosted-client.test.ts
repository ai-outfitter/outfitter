import { describe, it, expect, vi } from 'vitest';
import { CLIENT_ID, DEFAULT_HOSTED_ORIGIN, HostedClient, hostedOrigin } from '../../src/hosted/HostedClient.js';
import type { Credentials, HostedOAuth } from '../../src/hosted/HostedClient.js';

const ORIGIN = DEFAULT_HOSTED_ORIGIN;
const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 60, token_type: 'Bearer' };
const device = {
  device_code: 'private-code',
  user_code: 'BCDF-GHJK',
  verification_uri: `${ORIGIN}/device`,
  expires_in: 600,
  interval: 5,
};
const callbacks = (): Parameters<HostedOAuth['login']>[0] => ({
  onDeviceCode: vi.fn(),
  onAuth: vi.fn(),
  onPrompt: vi.fn(),
  onSelect: vi.fn().mockResolvedValue('device-code'),
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const model = { id: 'GLM-5.3-Flash-EXL3', name: 'GLM', context_length: 900000, max_output_tokens: 32768 };
const body = (call: Parameters<typeof globalThis.fetch>) =>
  JSON.parse(call[1]?.body as string) as Record<string, string>;

const fixture = (responses: Response[], origin?: string) => {
  let time = 0;
  const sleep = vi.fn((ms: number) => {
    time += ms;
    return Promise.resolve();
  });
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!));
  const client = new HostedClient({ fetch, now: () => time, sleep, origin });
  return { client, fetch, sleep };
};

describe('hosted authentication boundary', () => {
  it('defaults to the canonical webapp and permits HTTPS and loopback origins only', () => {
    expect(hostedOrigin()).toBe('https://ai-outfitter.com');
    expect(hostedOrigin('http://127.0.0.1:8123')).toBe('http://127.0.0.1:8123');
    expect(hostedOrigin('http://localhost:4390/')).toBe('http://localhost:4390');
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
  it('requests a device code and polls the token endpoint with RFC 8628 parameters', async () => {
    const { client, sleep, fetch } = fixture([
      response(device),
      response({ error: 'authorization_pending' }, 400),
      response({ error: 'slow_down' }, 400),
      response(tokens),
    ]);
    const cb = callbacks();
    const credentials = await client.oauth().login(cb);
    expect(credentials).toEqual({ access: 'access', refresh: 'refresh', expires: 80000, origin: ORIGIN });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([5000, 5000, 10000]);
    expect(fetch.mock.calls[0][0] as string).toBe(`${ORIGIN}/api/oauth/device/code`);
    expect(body(fetch.mock.calls[0])).toEqual({ client_id: CLIENT_ID, scope: 'inference' });
    expect(fetch.mock.calls[1][0] as string).toBe(`${ORIGIN}/api/oauth/token`);
    expect(body(fetch.mock.calls[1])).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'private-code',
      client_id: CLIENT_ID,
    });
    expect(fetch.mock.calls[1][1]?.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(cb.onDeviceCode).toHaveBeenCalledWith({
      userCode: 'BCDF-GHJK',
      verificationUri: `${ORIGIN}/device`,
      intervalSeconds: 5,
      expiresInSeconds: 600,
    });
    expect(client.oauth().getApiKey(credentials)).toBe('access');
    expect(fetch.mock.calls[0][1]?.redirect).toBe('error');
    expect(() => client.oauth().getApiKey({ ...credentials, origin: 'https://other.test' })).toThrow('another origin');
  });
  it('discovers models after native Pi login and rotates refresh tokens', async () => {
    const { client, fetch } = fixture([
      response(device),
      response(tokens),
      response({ ...tokens, refresh_token: 'next' }),
    ]);
    const after = vi.fn<(credentials: Credentials) => Promise<void>>().mockResolvedValue();
    const credential = await client.oauth(after).login(callbacks());
    expect(after).toHaveBeenCalledWith(credential);
    expect(await client.oauth().refreshToken(credential)).toMatchObject({ refresh: 'next', origin: client.origin });
    expect(body(fetch.mock.calls[2])).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'refresh',
      client_id: CLIENT_ID,
    });
  });
  it('uses an injected refresh, so Pi sessions can share one durable rotation', async () => {
    const refresh = vi.fn<(c: Credentials) => Promise<Credentials>>().mockResolvedValue({
      access: 'shared',
      refresh: 'r',
      expires: 1,
    });
    const { client } = fixture([]);
    expect(
      await client.provider([], undefined, refresh).oauth!.refreshToken({ access: 'a', refresh: 'r', expires: 0 }),
    ).toEqual({
      access: 'shared',
      refresh: 'r',
      expires: 1,
    });
  });
  it.each([
    [response({}, 503), 'unavailable'],
    [response({ ...device, interval: 0 }), 'Invalid'],
    [response({ ...device, expires_in: -1 }), 'Invalid'],
    [response({ ...device, device_code: '' }), 'Invalid'],
    [response({ ...device, user_code: '' }), 'Invalid'],
    [response({ ...device, verification_uri: '' }), 'Invalid'],
    [response({ ...device, verification_uri: 'https://attacker.example/device' }), 'Unexpected'],
    [response({ ...device, verification_uri: 'https://u:p@ai-outfitter.com/device' }), 'Unexpected'],
  ])('rejects invalid device enrollment %#', async (first, message) => {
    await expect(fixture([first]).client.login(callbacks())).rejects.toThrow(message);
  });
  it('expires without polling beyond the device lifetime', async () => {
    const { client, fetch } = fixture([response({ ...device, expires_in: 1 })]);
    await expect(client.login(callbacks())).rejects.toThrow('expired');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('reports denial, expiry and unreadable errors, and rejects invalid token responses', async () => {
    await expect(
      fixture([response(device), response({ error: 'access_denied' }, 400)]).client.login(callbacks()),
    ).rejects.toThrow('denied');
    await expect(
      fixture([response(device), response({ error: 'expired_token' }, 400)]).client.login(callbacks()),
    ).rejects.toThrow('expired');
    await expect(
      fixture([response(device), new Response('<html>', { status: 502 })]).client.login(callbacks()),
    ).rejects.toThrow('expired');
    await expect(fixture([response(device), response({ error: 7 }, 400)]).client.login(callbacks())).rejects.toThrow(
      'expired',
    );
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
  it('never sends refresh or revocation credentials to a different origin', async () => {
    const { client, fetch } = fixture([]);
    const foreign = { access: 'a', refresh: 'r', expires: 0, origin: 'https://elsewhere.example' };
    await expect(client.refreshToken(foreign)).rejects.toThrow('another origin');
    await expect(client.revoke(foreign)).rejects.toThrow('another origin');
    expect(fetch).not.toHaveBeenCalled();
    const denied = fixture([response({ error: 'invalid_grant' }, 400)]).client;
    await expect(denied.refreshToken({ access: 'a', refresh: 'r', expires: 0, origin: denied.origin })).rejects.toThrow(
      'expired or was revoked',
    );
  });
  it('revokes with RFC 7009 and reports failures', async () => {
    const { client, fetch } = fixture([new Response(null, { status: 200 }), response({}, 503)]);
    const credential = { access: 'a', refresh: 'r', expires: 0, origin: ORIGIN };
    await client.revoke(credential);
    expect(fetch.mock.calls[0][0] as string).toBe(`${ORIGIN}/api/oauth/revoke`);
    expect(body(fetch.mock.calls[0])).toEqual({ token: 'r', token_type_hint: 'refresh_token', client_id: CLIENT_ID });
    await expect(client.revoke(credential)).rejects.toThrow('(503)');
  });
  it('maps the relay model metadata to native Pi OpenAI streaming with tool support', async () => {
    const { client, fetch } = fixture([response({ data: [model] })]);
    const models = await client.models('secret');
    expect(models[0]).toMatchObject({
      id: model.id,
      name: 'GLM',
      contextWindow: 900000,
      maxTokens: 32768,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    expect(fetch.mock.calls[0][0] as string).toBe(`${ORIGIN}/api/inference/v1/models`);
    expect(client.provider(models)).toMatchObject({
      api: 'openai-completions',
      baseUrl: `${ORIGIN}/api/inference/v1`,
      models,
    });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer secret' });
  });
  it('defaults metadata an older server omits', async () => {
    const { client } = fixture([response({ data: [{ id: 'bare' }] })]);
    expect((await client.models('a'))[0]).toMatchObject({ name: 'bare', contextWindow: 128000, maxTokens: 32768 });
  });
  it('reads identity from userinfo and redacts server error bodies', async () => {
    const { client, fetch } = fixture([
      response({ sub: 'u1', email: 'a@example.com' }),
      response({ secret: 'x' }, 403),
    ]);
    expect(await client.identity('a')).toEqual({ sub: 'u1', email: 'a@example.com' });
    expect(fetch.mock.calls[0][0] as string).toBe(`${ORIGIN}/api/oauth/userinfo`);
    expect(fetch.mock.calls[0][1]?.method).toBe('GET');
    await expect(client.api('/denied', 'a')).rejects.toThrow('Outfitter request failed (403).');
  });
  it('scopes everything to a configured trusted origin', async () => {
    const { client, fetch } = fixture(
      [response({ ...device, verification_uri: 'http://localhost:4390/device' }), response(tokens)],
      'http://localhost:4390',
    );
    expect(await client.login(callbacks())).toMatchObject({ origin: 'http://localhost:4390' });
    expect(fetch.mock.calls[0][0] as string).toBe('http://localhost:4390/api/oauth/device/code');
  });
});
