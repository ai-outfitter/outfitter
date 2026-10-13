import { join } from 'node:path';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { resolvePiUserAgentDirectory } from '../agents/PiCredentialPersistence.js';
import { HostedClient } from './HostedClient.js';
import type { Credentials, HostedIdentity, HostedOAuth, ProviderConfig } from './HostedClient.js';

/** Uses Pi's own locked credential store and refresh implementation; other providers are preserved. */
export class HostedSession {
  constructor(
    readonly client: HostedClient,
    readonly auth: AuthStorage,
  ) {
    ModelRegistry.inMemory(auth).registerProvider('outfitter', this.provider());
  }
  provider(
    models: ProviderConfig['models'] = [],
    afterLogin?: (credentials: Credentials) => Promise<void>,
  ): ProviderConfig {
    const config = this.client.provider(models, afterLogin);
    const oauth = config.oauth!;
    return {
      ...config,
      oauth: {
        ...oauth,
        login: async (callbacks) => {
          this.auth.reload();
          const previous = this.auth.get('outfitter');
          if (previous?.type === 'oauth' && previous.pendingRevocation === true) await this.logout();
          return oauth.login(callbacks);
        },
      },
    };
  }
  async access(): Promise<string> {
    this.auth.reload();
    const credential = this.auth.get('outfitter');
    if (credential?.type !== 'oauth') throw new Error('Run outfitter login first.');
    this.client.assertOrigin(credential);
    if (credential.pendingRevocation === true)
      throw new Error('Outfitter logout is pending. Run outfitter logout to retry.');
    const access = await this.auth.getApiKey('outfitter');
    if (!access) throw new Error('Run outfitter login again.');
    return access;
  }
  async login(callbacks: Parameters<HostedOAuth['login']>[0]): Promise<HostedIdentity> {
    await this.auth.login('outfitter', callbacks);
    return this.identity();
  }
  async identity(): Promise<HostedIdentity> {
    return this.client.api('/api/cli/me', await this.access());
  }
  async logout(): Promise<void> {
    // Revocation remains available when new login/refresh is disabled. The server
    // accepts this device's last access credential for revocation only, even expired.
    this.auth.reload();
    const credential = this.auth.get('outfitter');
    if (credential?.type !== 'oauth') throw new Error('Run outfitter login first.');
    this.client.assertOrigin(credential);
    await this.client.api('/api/cli/logout', credential.access, {}, 'POST');
    this.auth.logout('outfitter');
  }
}

export const createHostedSession = (homeDirectory: string): HostedSession =>
  new HostedSession(
    new HostedClient(),
    AuthStorage.create(join(resolvePiUserAgentDirectory(homeDirectory), 'auth.json')),
  );
