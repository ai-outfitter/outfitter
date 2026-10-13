import { setTimeout } from 'node:timers/promises';
import { openBrowser } from './OpenBrowser.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export type ProviderConfig = Parameters<ExtensionAPI['registerProvider']>[1];
export type HostedOAuth = NonNullable<ProviderConfig['oauth']>;
export type Credentials = Awaited<ReturnType<HostedOAuth['login']>>;
/** OpenID Connect UserInfo claim names from `/api/oauth/userinfo`. */
export interface HostedIdentity {
  sub: string;
  name?: string;
  email?: string;
}
/** `/api/inference/v1/models` entries; metadata fields are optional for older servers. */
export interface HostedModel {
  id: string;
  name?: string;
  context_length?: number;
  max_output_tokens?: number;
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
interface Device {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}
export interface HostedClientOptions {
  origin?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  openBrowser?: (url: string) => Promise<boolean>;
}

/** The webapp's canonical origin; `app.ai-outfitter.com` only redirects here. */
export const DEFAULT_HOSTED_ORIGIN = 'https://ai-outfitter.com';
/** The webapp's public OAuth client for this CLI (RFC 8628 device authorization grant). */
export const CLIENT_ID = 'outfitter-cli';
export const SCOPE = 'inference';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 32_768;

export const hostedOrigin = (value = DEFAULT_HOSTED_ORIGIN): string => {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('Outfitter origin must be an HTTPS origin (HTTP is allowed only on loopback).');
  return url.origin;
};

const validateDevice = (device: Device): void => {
  if (
    !device.device_code ||
    !device.user_code ||
    !device.verification_uri ||
    !Number.isFinite(device.expires_in) ||
    device.expires_in <= 0 ||
    !Number.isFinite(device.interval) ||
    device.interval <= 0
  )
    throw new Error('Invalid Outfitter device response.');
};

const oauthError = async (response: Response): Promise<string | undefined> => {
  const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
  return typeof body?.error === 'string' ? body.error : undefined;
};

export class HostedClient {
  readonly origin: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly openBrowser: (url: string) => Promise<boolean>;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  constructor(options: HostedClientOptions = {}) {
    this.origin = hostedOrigin(options.origin);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? Date.now;
    this.openBrowser = options.openBrowser ?? openBrowser;
    this.sleep =
      options.sleep ??
      (async (ms, signal) => {
        await setTimeout(ms, undefined, { signal });
      });
  }
  get baseUrl(): string {
    return `${this.origin}/api/inference/v1`;
  }
  private async request(path: string, body?: unknown, access?: string, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(15_000);
    return this.fetcher(`${this.origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(access === undefined ? {} : { Authorization: `Bearer ${access}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
    });
  }
  async api<T>(path: string, access: string): Promise<T> {
    const response = await this.request(path, undefined, access);
    if (!response.ok) throw new Error(`Outfitter request failed (${response.status}).`);
    return (await response.json()) as T;
  }
  private tokens(tokens: Tokens): Credentials {
    if (!tokens.access_token || !tokens.refresh_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0)
      throw new Error('Invalid Outfitter token response.');
    return {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: this.now() + tokens.expires_in * 1000,
      origin: this.origin,
    };
  }
  assertOrigin(credentials: Credentials): void {
    if (credentials.origin !== this.origin)
      throw new Error('Outfitter credentials belong to another origin. Log in again.');
  }
  private verificationURL(value: string, device: Device): URL {
    const verification = new URL(value);
    if (verification.origin !== this.origin || verification.username || verification.password)
      throw new Error('Unexpected Outfitter verification origin.');
    if (!verification.searchParams.has('user_code')) verification.searchParams.set('user_code', device.user_code);
    return verification;
  }
  private async showApproval(
    device: Device,
    callbacks: Parameters<HostedOAuth['login']>[0],
    method: 'browser' | 'device-code',
  ): Promise<void> {
    const plain = new URL(device.verification_uri);
    if (plain.origin !== this.origin || plain.username || plain.password)
      throw new Error('Unexpected Outfitter verification origin.');
    if (method === 'browser') {
      const verification = this.verificationURL(device.verification_uri_complete ?? device.verification_uri, device);
      callbacks.onAuth({
        url: verification.href,
        instructions: `Confirm the code ${device.user_code} in your browser, then approve.`,
      });
      const opened = await this.openBrowser(verification.href).catch(() => false);
      callbacks.onProgress?.(
        opened
          ? 'Waiting for browser approval…'
          : 'Could not open a browser. Open the displayed URL manually, or retry with outfitter login --device-code.',
      );
    } else {
      callbacks.onDeviceCode({
        userCode: device.user_code,
        verificationUri: plain.href,
        intervalSeconds: device.interval,
        expiresInSeconds: device.expires_in,
      });
    }
  }
  /** RFC 8628: request a device code, show it, then poll until approval, denial or expiry. */
  async login(
    callbacks: Parameters<HostedOAuth['login']>[0],
    method: 'browser' | 'device-code' = 'device-code',
  ): Promise<Credentials> {
    const response = await this.request(
      '/api/oauth/device/code',
      { client_id: CLIENT_ID, scope: SCOPE },
      undefined,
      callbacks.signal,
    );
    if (!response.ok) throw new Error(`Outfitter sign-in unavailable (${response.status}).`);
    const device = (await response.json()) as Device;
    validateDevice(device);
    await this.showApproval(device, callbacks, method);
    const deadline = this.now() + device.expires_in * 1000;
    let interval = device.interval * 1000;
    while (this.now() < deadline) {
      await this.sleep(interval, callbacks.signal);
      if (this.now() >= deadline) break;
      const polled = await this.request(
        '/api/oauth/token',
        { grant_type: DEVICE_GRANT, device_code: device.device_code, client_id: CLIENT_ID },
        undefined,
        callbacks.signal,
      );
      if (polled.ok) return this.tokens((await polled.json()) as Tokens);
      const error = await oauthError(polled);
      if (error === 'slow_down') interval += 5000;
      else if (error === 'access_denied') throw new Error('Outfitter sign-in was denied in the browser.');
      else if (error !== 'authorization_pending') throw new Error('Outfitter sign-in expired. Start login again.');
    }
    throw new Error('Outfitter sign-in expired. Start login again.');
  }
  /** Rotates both tokens; the server revokes the session if a replaced refresh token is reused. */
  async refreshToken(credentials: Credentials): Promise<Credentials> {
    this.assertOrigin(credentials);
    const response = await this.request('/api/oauth/token', {
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh,
      client_id: CLIENT_ID,
    });
    if (!response.ok) throw new Error('Outfitter session expired or was revoked. Run outfitter login.');
    return this.tokens((await response.json()) as Tokens);
  }
  /** RFC 7009: revoking either token ends the device session on the server. */
  async revoke(credentials: Credentials): Promise<void> {
    this.assertOrigin(credentials);
    const response = await this.request('/api/oauth/revoke', {
      token: credentials.refresh,
      token_type_hint: 'refresh_token',
      client_id: CLIENT_ID,
    });
    if (!response.ok) throw new Error(`Outfitter logout failed (${response.status}).`);
  }
  identity(access: string): Promise<HostedIdentity> {
    return this.api<HostedIdentity>('/api/oauth/userinfo', access);
  }
  oauth(
    afterLogin?: (credentials: Credentials) => Promise<void>,
    refresh: (credentials: Credentials) => Promise<Credentials> = (credentials) => this.refreshToken(credentials),
  ): HostedOAuth {
    return {
      name: 'Outfitter',
      login: async (callbacks) => {
        const method = await callbacks.onSelect({
          message: 'How would you like to sign in to Outfitter?',
          options: [
            { id: 'browser', label: 'Open browser (recommended)' },
            { id: 'device-code', label: 'Device code (SSH / headless)' },
          ],
        });
        if (method !== 'browser' && method !== 'device-code') throw new Error('Outfitter login cancelled.');
        const credentials = await this.login(callbacks, method);
        await afterLogin?.(credentials);
        return credentials;
      },
      refreshToken: refresh,
      getApiKey: (credentials) => {
        this.assertOrigin(credentials);
        return credentials.access;
      },
    };
  }
  async models(access: string): Promise<NonNullable<ProviderConfig['models']>> {
    const result = await this.api<{ data: HostedModel[] }>('/api/inference/v1/models', access);
    return result.data.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      reasoning: false,
      input: ['text'],
      // Personal Outfitter inference is not billed per token.
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: model.context_length ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: model.max_output_tokens ?? DEFAULT_MAX_TOKENS,
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        maxTokensField: 'max_tokens',
        supportsUsageInStreaming: true,
      },
    }));
  }
  provider(
    models: ProviderConfig['models'] = [],
    afterLogin?: (credentials: Credentials) => Promise<void>,
    refresh?: (credentials: Credentials) => Promise<Credentials>,
  ): ProviderConfig {
    return {
      name: 'Outfitter',
      baseUrl: this.baseUrl,
      api: 'openai-completions',
      models,
      oauth: this.oauth(afterLogin, refresh),
    };
  }
}
