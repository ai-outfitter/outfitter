import { FileAuthStorageBackend } from '@earendil-works/pi-coding-agent';
import {
  piAuthIdentity,
  recordedWritebackBaseline,
  withWritebackBaseline,
  withoutWritebackBaseline,
} from '../agents/PiCredentialPersistence.js';
import type { Credentials, HostedClient } from './HostedClient.js';

export const HOSTED_PROVIDER = 'outfitter';

type Stored = Credentials & { type?: string; pendingRevocation?: boolean };

const parse = (current: string | undefined): Record<string, Stored> =>
  current?.trim() ? (JSON.parse(current) as Record<string, Stored>) : {};

const credential = (stored: Stored): Credentials => {
  const rest: Partial<Stored> = { ...stored };
  delete rest.type;
  return rest as Credentials;
};

/** Snapshot any origin's durable entry before an explicit login can replace it. */
export const durableLoginBaseline = (authPath: string): string | null =>
  new FileAuthStorageBackend(authPath).withLock((current) => ({
    result: piAuthIdentity(parse(current)[HOSTED_PROVIDER]) ?? null,
  }));

/** Commit a new device login only if the durable credential still matches its pre-login snapshot. */
export const commitDurableLogin = (
  authPath: string,
  credentials: Credentials,
  expected: string | null,
): string | undefined =>
  new FileAuthStorageBackend(authPath).withLock((current) => {
    const data = parse(current);
    const stored = data[HOSTED_PROVIDER];
    if ((piAuthIdentity(stored) ?? null) !== expected || stored?.pendingRevocation === true)
      return { result: undefined };
    const nextEntry = { type: 'oauth', ...withoutWritebackBaseline(credentials) };
    return {
      result: piAuthIdentity(nextEntry),
      next: JSON.stringify({ ...data, [HOSTED_PROVIDER]: nextEntry }, null, 2),
    };
  });

/**
 * The durable entry changed while an explicit login was in progress or before its credential reached
 * the durable file. The login may be for a different account than the durable entry, so neither is
 * adopted in place of the other, and the durable entry, which other runs share, is left alone.
 */
export class DurableLoginConflictError extends Error {
  constructor() {
    super(
      'Outfitter sign-in was not saved: another session changed the stored Outfitter credentials meanwhile. The new sign-in was discarded and the stored credentials were kept. Run outfitter login again.',
    );
    this.name = 'DurableLoginConflictError';
  }
}

/** The local credential is this run's explicit login and the durable entry no longer matches what it observed. */
const loginConflicts = (local: Credentials, stored: Stored | undefined): boolean => {
  const recorded = recordedWritebackBaseline(local);
  return recorded?.source === 'login' && piAuthIdentity(stored) !== recorded.digest;
};

/** Under Pi's lock, whether the durable entry changed since `local`, a credential from this run's login, observed it. */
export const durableLoginConflict = (authPath: string, local: Credentials): boolean =>
  new FileAuthStorageBackend(authPath).withLock((current) => ({
    result: loginConflicts(local, parse(current)[HOSTED_PROVIDER]),
  }));

/**
 * Revoke a login credential that lost a {@link DurableLoginConflictError} only when it is no longer
 * the durable token. A refresh token still stored there may be active in another run. Best effort:
 * the conflict, not a failed revocation, is what the user needs to act on.
 */
export const revokeConflictingLogin = async (
  client: HostedClient,
  authPath: string,
  local: Credentials,
): Promise<void> => {
  const stored = new FileAuthStorageBackend(authPath).withLock((current) => ({
    result: parse(current)[HOSTED_PROVIDER],
  }));
  if (stored?.refresh === local.refresh) return;
  await client.revoke(withoutWritebackBaseline(local)).catch(() => undefined);
};

/** The local credential came from this run's login or refresh and the durable entry is unchanged since. */
const localIsNewest = (local: Credentials, stored: Stored | undefined): boolean => {
  const recorded = recordedWritebackBaseline(local);
  return recorded !== undefined && piAuthIdentity(stored) === recorded.digest;
};

/** Whether the durable entry is this origin's to adopt; throws when the refresh must not proceed. */
const refreshable = (local: Credentials, stored: Stored | undefined, origin: string): stored is Stored => {
  if (loginConflicts(local, stored)) throw new DurableLoginConflictError();
  const usable = stored?.type === 'oauth' && stored.origin === origin;
  if (usable && stored.pendingRevocation === true)
    throw new Error('Outfitter logout is pending. Run outfitter logout to retry.');
  return usable;
};

/**
 * Outfitter runs Pi with a per-run copy of auth.json, so concurrent sessions
 * would each rotate the same refresh token and the server revokes a reused
 * one. Every refresh therefore goes through the durable `~/.pi/agent/auth.json`
 * under Pi's file lock: a session whose copy is stale adopts the credential
 * another session already rotated, and only the newest refresh token is used.
 * A credential from this run's login or refresh records the durable digest it
 * observed; while the durable entry still matches it, the local credential is
 * the newest and is the one refreshed and written back. A login whose durable
 * entry changed since fails with {@link DurableLoginConflictError} instead of
 * adopting what may be another account's credential.
 */
export const durableRefresh =
  (client: HostedClient, authPath: string) =>
  (credentials: Credentials): Promise<Credentials> =>
    new FileAuthStorageBackend(authPath).withLockAsync(async (current) => {
      const data = parse(current);
      const stored = data[HOSTED_PROVIDER];
      const usable = refreshable(credentials, stored, client.origin);
      const adopt = usable && !localIsNewest(credentials, stored);
      if (adopt && stored.refresh !== credentials.refresh && stored.expires > Date.now()) {
        const adopted = withoutWritebackBaseline(credential(stored));
        return { result: withWritebackBaseline(adopted, { source: 'refresh', digest: piAuthIdentity(stored) }) };
      }
      const next = await client.refreshToken(withoutWritebackBaseline(adopt ? credential(stored) : credentials));
      const storedNext = { type: 'oauth', ...next };
      return {
        result: withWritebackBaseline(next, {
          source: recordedWritebackBaseline(credentials)?.source ?? 'refresh',
          digest: piAuthIdentity(storedNext),
        }),
        next: JSON.stringify({ ...data, [HOSTED_PROVIDER]: storedNext }, null, 2),
      };
    });

/** The durable copy of the Outfitter credential for this origin, if any. */
export const durableCredential = (client: HostedClient, authPath: string): Credentials | undefined =>
  new FileAuthStorageBackend(authPath).withLock((current) => {
    const stored = parse(current)[HOSTED_PROVIDER];
    return { result: stored?.type === 'oauth' && stored.origin === client.origin ? credential(stored) : undefined };
  });

/**
 * Record a pending revocation in the durable file before Pi's synchronous logout returns, so a run
 * that exits before the server answers is retried at the next start. The durable entry for this
 * origin is marked even when another run has rotated it since, because `revokeAll` revokes that
 * copy too; an entry for another origin is left alone. A missing entry is restored, marked.
 */
export const markPendingRevocation = (authPath: string, local: Credentials): void => {
  new FileAuthStorageBackend(authPath).withLock((current) => {
    const data = parse(current);
    const stored = data[HOSTED_PROVIDER];
    if (stored !== undefined && (stored.type !== 'oauth' || stored.origin !== local.origin))
      return { result: undefined };
    const pending = { type: 'oauth', ...withoutWritebackBaseline(stored ?? local), pendingRevocation: true };
    return { result: undefined, next: JSON.stringify({ ...data, [HOSTED_PROVIDER]: pending }, null, 2) };
  });
};

/** Remove the durable credential if it belongs to one of the revoked sessions. */
export const forgetDurable = (authPath: string, revoked: readonly Credentials[]): void => {
  new FileAuthStorageBackend(authPath).withLock((current) => {
    const data = parse(current);
    const stored = data[HOSTED_PROVIDER];
    if (!stored || !revoked.some((entry) => entry.refresh === stored.refresh)) return { result: undefined };
    delete data[HOSTED_PROVIDER];
    return { result: undefined, next: JSON.stringify(data, null, 2) };
  });
};

/** Revoke this copy and the durable copy, which may be a newer rotation of the same session. */
export const revokeAll = async (
  client: HostedClient,
  authPath: string | undefined,
  local: Credentials,
): Promise<Credentials[]> => {
  const copies = [local];
  const durable = authPath === undefined ? undefined : durableCredential(client, authPath);
  if (durable && durable.refresh !== local.refresh) copies.push(durable);
  for (const copy of copies) await client.revoke(copy);
  return copies;
};
