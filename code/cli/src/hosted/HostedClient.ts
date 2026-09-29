import { setTimeout } from 'node:timers/promises';
import { openBrowser } from './OpenBrowser.js';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export type ProviderConfig = Parameters<ExtensionAPI['registerProvider']>[1];
export type HostedOAuth = NonNullable<ProviderConfig['oauth']>;
export type Credentials = Awaited<ReturnType<HostedOAuth['login']>>;
export interface HostedIdentity {
  user: { id: string; login: string; name?: string; email?: string };
}
export interface HostedModel {
  id: string;
  name: string;
  context_length: number;
  max_output_tokens: number;
  pricing?: { prompt: string; completion: string };
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

export const hostedOrigin = (value = 'https://beta.ai-outfitter.com'): string => {
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
    !Number.isFinite(device.expires_in) ||
    device.expires_in <= 0 ||
    !Number.isFinite(device.interval) ||
    device.interval <= 0
  )
    throw new Error('Invalid Outfitter device response.');
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
  private async request(
    path: string,
    body?: unknown,
    access?: string,
    method?: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(15_000);
    return this.fetcher(`${this.origin}${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        'Content-Type': 'application/json',
        ...(access === undefined ? {} : { Authorization: `Bearer ${access}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: signal === undefined ? timeout : AbortSignal.any([timeout, signal]),
    });
  }
  async api<T>(path: string, access: string, body?: unknown, method?: string): Promise<T> {
    const response = await this.request(path, body, access, method);
    if (!response.ok) throw new Error(`Outfitter request failed (${response.status}).`);
    return (response.status === 204 ? undefined : await response.json()) as T;
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
  private async showApproval(
    device: Device,
    callbacks: Parameters<HostedOAuth['login']>[0],
    method: 'browser' | 'device-code',
  ): Promise<void> {
    const verification = new URL(device.verification_uri);
    if (verification.origin !== this.origin || verification.username || verification.password)
      throw new Error('Unexpected Outfitter verification origin.');
    if (method === 'browser') {
      verification.searchParams.set('user_code', device.user_code);
      callbacks.onAuth({
        url: verification.href,
        instructions: 'Approve this CLI in your browser. No code entry is needed.',
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
        verificationUri: verification.href,
        intervalSeconds: device.interval,
        expiresInSeconds: device.expires_in,
      });
    }
  }
  async login(
    callbacks: Parameters<HostedOAuth['login']>[0],
    method: 'browser' | 'device-code' = 'device-code',
  ): Promise<Credentials> {
    const response = await this.request('/api/cli/device', {}, undefined, undefined, callbacks.signal);
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
        '/api/cli/token',
        { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: device.device_code },
        undefined,
        undefined,
        callbacks.signal,
      );
      if (polled.ok) return this.tokens((await polled.json()) as Tokens);
      const error = (await polled.json()) as { error: string };
      if (error.error === 'slow_down') interval += 5000;
      else if (error.error !== 'authorization_pending')
        throw new Error('Outfitter sign-in denied or expired. Start login again.');
    }
    throw new Error('Outfitter sign-in expired. Start login again.');
  }
  async refreshToken(credentials: Credentials): Promise<Credentials> {
    this.assertOrigin(credentials);
    const response = await this.request('/api/cli/token', {
      grant_type: 'refresh_token',
      refresh_token: credentials.refresh,
    });
    if (!response.ok) throw new Error('Outfitter session expired. Run outfitter login.');
    return this.tokens((await response.json()) as Tokens);
  }
  oauth(afterLogin?: (credentials: Credentials) => Promise<void>): HostedOAuth {
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
      refreshToken: (credentials) => this.refreshToken(credentials),
      getApiKey: (credentials) => {
        this.assertOrigin(credentials);
        return credentials.access;
      },
    };
  }
  async models(access: string): Promise<NonNullable<ProviderConfig['models']>> {
    const result = await this.api<{ data: HostedModel[] }>('/v1/models', access);
    return result.data.map((model) => ({
      id: model.id,
      name: model.name,
      reasoning: false,
      input: ['text'],
      cost: {
        input: Number(model.pricing?.prompt ?? 0) * 1e6,
        output: Number(model.pricing?.completion ?? 0) * 1e6,
        cacheRead: 0,
        cacheWrite: 0,
      },
      contextWindow: model.context_length,
      maxTokens: model.max_output_tokens,
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
  ): ProviderConfig {
    return {
      name: 'Outfitter',
      baseUrl: `${this.origin}/v1`,
      api: 'openai-completions',
      models,
      oauth: this.oauth(afterLogin),
    };
  }
}
