import { FileAuthStorageBackend } from '@earendil-works/pi-coding-agent';
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

/**
 * Outfitter runs Pi with a per-run copy of auth.json, so concurrent sessions
 * would each rotate the same refresh token and the server revokes a reused
 * one. Every refresh therefore goes through the durable `~/.pi/agent/auth.json`
 * under Pi's file lock: a session whose copy is stale adopts the credential
 * another session already rotated, and only the newest refresh token is used.
 */
export const durableRefresh =
  (client: HostedClient, authPath: string) =>
  (credentials: Credentials): Promise<Credentials> =>
    new FileAuthStorageBackend(authPath).withLockAsync(async (current) => {
      const data = parse(current);
      const stored = data[HOSTED_PROVIDER];
      const usable = stored?.type === 'oauth' && stored.origin === client.origin;
      if (usable && stored.pendingRevocation === true)
        throw new Error('Outfitter logout is pending. Run outfitter logout to retry.');
      if (usable && stored.refresh !== credentials.refresh && stored.expires > Date.now())
        return { result: credential(stored) };
      const next = await client.refreshToken(usable ? credential(stored) : credentials);
      return {
        result: next,
        next: JSON.stringify({ ...data, [HOSTED_PROVIDER]: { type: 'oauth', ...next } }, null, 2),
      };
    });

/** The durable copy of the Outfitter credential for this origin, if any. */
export const durableCredential = (client: HostedClient, authPath: string): Credentials | undefined =>
  new FileAuthStorageBackend(authPath).withLock((current) => {
    const stored = parse(current)[HOSTED_PROVIDER];
    return { result: stored?.type === 'oauth' && stored.origin === client.origin ? credential(stored) : undefined };
  });

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
