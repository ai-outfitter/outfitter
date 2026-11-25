import { join } from 'node:path';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import {
  recordedWritebackBaseline,
  resolvePiUserAgentDirectory,
  withWritebackBaseline,
} from '../agents/PiCredentialPersistence.js';
import { hostedSettings } from './ExperimentalProvider.js';
import {
  HOSTED_PROVIDER,
  DurableLoginConflictError,
  commitDurableLogin,
  durableLoginConflict,
  durableRefresh,
  forgetDurable,
  revokeAll,
  durableCredential,
  durableLoginBaseline,
  revokeConflictingLogin,
} from './DurableCredentials.js';
import { HostedClient } from './HostedClient.js';
import type { Credentials, HostedIdentity, HostedOAuth, ProviderConfig } from './HostedClient.js';

const loginCredential = (entry: ReturnType<AuthStorage['get']>): Credentials | undefined => {
  if (entry?.type !== 'oauth' || recordedWritebackBaseline(entry)?.source !== 'login') return undefined;
  return entry;
};

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
          const baseline = await this.prepareLogin();
          const credentials = await oauth.login(callbacks);
          if (baseline === undefined || this.durablePath === undefined) return credentials;
          // Commit under Pi's lock before reporting login success. A concurrent refresh, sign-in, or
          // logout during the device wait makes the snapshot stale, so discard this grant safely.
          let committed: string | undefined;
          try {
            committed = commitDurableLogin(this.durablePath, credentials, baseline);
          } catch {
            await this.client.revoke(credentials).catch(() => undefined);
            throw new Error(
              'Outfitter sign-in could not be saved. The new sign-in was discarded; run outfitter login again.',
            );
          }
          if (committed === undefined) {
            await revokeConflictingLogin(this.client, this.durablePath, credentials);
            throw new DurableLoginConflictError();
          }
          return withWritebackBaseline(credentials, { source: 'login', digest: committed });
        },
      },
    };
  }
  private async prepareLogin(): Promise<string | null | undefined> {
    this.auth.reload();
    const previous = this.auth.get(HOSTED_PROVIDER);
    const durable = this.durablePath === undefined ? undefined : durableCredential(this.client, this.durablePath);
    if (durable?.pendingRevocation === true) this.auth.set(HOSTED_PROVIDER, { type: 'oauth', ...durable });
    if ((previous?.type === 'oauth' && previous.pendingRevocation === true) || durable?.pendingRevocation === true)
      await this.logout();
    return this.durablePath === undefined ? undefined : durableLoginBaseline(this.durablePath);
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
  /**
   * Reports success only while the durable entry is still what the login observed. Pi swallows a
   * refresh's {@link DurableLoginConflictError}, so the conflict is checked again here, both when
   * the identity check fails and before it is reported.
   */
  async login(callbacks: Parameters<HostedOAuth['login']>[0]): Promise<HostedIdentity> {
    await this.auth.login(HOSTED_PROVIDER, callbacks);
    const login = this.auth.get(HOSTED_PROVIDER);
    let identity: HostedIdentity;
    try {
      identity = await this.identity();
    } catch (error) {
      await this.rejectConflictingLogin(login);
      throw error;
    }
    await this.rejectConflictingLogin(login);
    this.clearLoginProvenance();
    return identity;
  }
  /** Revokes and removes this run's login if the durable entry changed since it observed it; the durable one is kept. */
  private conflictingLogin(login: ReturnType<AuthStorage['get']>): Credentials | undefined {
    if (this.durablePath === undefined) return;
    const original = loginCredential(login);
    if (!original) return;
    this.auth.reload();
    const current = loginCredential(this.auth.get(HOSTED_PROVIDER));
    if (!current || current.origin !== original.origin) return;
    if (!durableLoginConflict(this.durablePath, current)) return;
    return current;
  }
  private async rejectConflictingLogin(login: ReturnType<AuthStorage['get']>): Promise<void> {
    const current = this.conflictingLogin(login);
    if (!current || this.durablePath === undefined) return;
    await revokeConflictingLogin(this.client, this.durablePath, current);
    // Not logout: Pi's may be wrapped to revoke the durable entry too.
    this.auth.remove(HOSTED_PROVIDER);
    throw new DurableLoginConflictError();
  }
  /** Once the new identity is confirmed, later refreshes may adopt concurrent rotations normally. */
  private clearLoginProvenance(): void {
    this.auth.reload();
    const current = this.auth.get(HOSTED_PROVIDER);
    const recorded = recordedWritebackBaseline(current);
    if (current?.type === 'oauth' && recorded?.source === 'login')
      this.auth.set(HOSTED_PROVIDER, withWritebackBaseline(current, { source: 'refresh', digest: recorded.digest }));
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
