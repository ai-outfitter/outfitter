import { join } from 'node:path';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { resolvePiUserAgentDirectory } from '../agents/PiCredentialPersistence.js';
import { hostedSettings } from './ExperimentalProvider.js';
import { HOSTED_PROVIDER, durableRefresh, forgetDurable, revokeAll } from './DurableCredentials.js';
import { HostedClient } from './HostedClient.js';
import type { Credentials, HostedIdentity, HostedOAuth, ProviderConfig } from './HostedClient.js';

/**
 * Uses Pi's own locked credential store and refresh implementation; other providers are preserved.
 * `durablePath` is the persistent `~/.pi/agent/auth.json` when `auth` is a per-run copy of it.
 */
export class HostedSession {
  constructor(
    readonly client: HostedClient,
    readonly auth: AuthStorage,
    readonly durablePath?: string,
  ) {
    ModelRegistry.inMemory(auth).registerProvider(HOSTED_PROVIDER, this.provider());
  }
  provider(
    models: ProviderConfig['models'] = [],
    afterLogin?: (credentials: Credentials) => Promise<void>,
  ): ProviderConfig {
    const refresh = this.durablePath === undefined ? undefined : durableRefresh(this.client, this.durablePath);
    const config = this.client.provider(models, afterLogin, refresh);
    const oauth = config.oauth!;
    return {
      ...config,
      oauth: {
        ...oauth,
        login: async (callbacks) => {
          this.auth.reload();
          const previous = this.auth.get(HOSTED_PROVIDER);
          if (previous?.type === 'oauth' && previous.pendingRevocation === true) await this.logout();
          return oauth.login(callbacks);
        },
      },
    };
  }
  async access(): Promise<string> {
    this.auth.reload();
    const credential = this.auth.get(HOSTED_PROVIDER);
    if (credential?.type !== 'oauth') throw new Error('Run outfitter login first.');
    this.client.assertOrigin(credential);
    if (credential.pendingRevocation === true)
      throw new Error('Outfitter logout is pending. Run outfitter logout to retry.');
    const access = await this.auth.getApiKey(HOSTED_PROVIDER, { includeFallback: false });
    if (!access) throw new Error('Outfitter session expired or was revoked. Run outfitter login.');
    return access;
  }
  async login(callbacks: Parameters<HostedOAuth['login']>[0]): Promise<HostedIdentity> {
    await this.auth.login(HOSTED_PROVIDER, callbacks);
    return this.identity();
  }
  async identity(): Promise<HostedIdentity> {
    return this.client.identity(await this.access());
  }
  /** Revoke remotely first; local credentials stay until the server confirms, so logout can be retried. */
  async logout(): Promise<void> {
    this.auth.reload();
    const credential = this.auth.get(HOSTED_PROVIDER);
    if (credential?.type !== 'oauth') throw new Error('Run outfitter login first.');
    this.client.assertOrigin(credential);
    const revoked = await revokeAll(this.client, this.durablePath, credential);
    this.auth.logout(HOSTED_PROVIDER);
    if (this.durablePath !== undefined) forgetDurable(this.durablePath, revoked);
  }
}

export const createHostedSession = (homeDirectory: string): HostedSession =>
  new HostedSession(
    new HostedClient({ origin: hostedSettings(homeDirectory).origin }),
    AuthStorage.create(join(resolvePiUserAgentDirectory(homeDirectory), 'auth.json')),
  );
