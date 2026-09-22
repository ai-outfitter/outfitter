import { join } from 'node:path';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { resolvePiUserAgentDirectory } from '../agents/PiCredentialPersistence.js';
import { HostedClient } from './HostedClient.js';
import type { HostedIdentity, HostedOAuth } from './HostedClient.js';

/** Uses Pi's own locked credential store and refresh implementation; other providers are preserved. */
export class HostedSession {
  constructor(
    readonly client: HostedClient,
    readonly auth: AuthStorage,
  ) {
    ModelRegistry.inMemory(auth).registerProvider('outfitter', client.provider());
  }
  async access(): Promise<string> {
    this.auth.reload();
    const credential = this.auth.get('outfitter');
    if (credential?.type !== 'oauth') throw new Error('Run outfitter login first.');
    this.client.assertOrigin(credential);
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
  async workspace(id: string): Promise<HostedIdentity> {
    const access = await this.access();
    const identity = await this.client.api<HostedIdentity>('/api/cli/workspace', access, { workspace_id: id }, 'PUT');
    await this.client.models(access);
    return identity;
  }
  async usage(): Promise<unknown> {
    return this.client.api('/api/cli/usage', await this.access());
  }
  async logout(): Promise<void> {
    const access = await this.access();
    await this.client.api('/api/cli/logout', access, {}, 'POST');
    this.auth.logout('outfitter');
  }
}

export const createHostedSession = (homeDirectory: string, env: NodeJS.ProcessEnv): HostedSession =>
  new HostedSession(
    new HostedClient({ origin: env.OUTFITTER_API_ORIGIN }),
    AuthStorage.create(join(resolvePiUserAgentDirectory(homeDirectory), 'auth.json')),
  );
