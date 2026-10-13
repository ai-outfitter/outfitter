import type { AuthStorage } from '@earendil-works/pi-coding-agent';
import { HOSTED_PROVIDER, forgetDurable, markPendingRevocation, revokeAll } from './DurableCredentials.js';
import { HostedClient } from './HostedClient.js';

/**
 * Pi's native logout is synchronous, so it cannot wait for the server. Before it returns, the
 * pending revocation is recorded in this run's auth and, under Pi's lock, in the durable file; the
 * revocation then runs in the background and is retried at the next start if this run exits first.
 * Only `/outfitter-logout` and `outfitter logout` wait for the server's answer.
 */
export const installPiLogout = (
  auth: AuthStorage,
  client: HostedClient,
  notify: (message: string, type: 'info' | 'error') => void,
  durablePath?: string,
): void => {
  const original = auth.logout.bind(auth);
  const revoke = (): void => {
    const credential = auth.get(HOSTED_PROVIDER);
    if (credential?.type !== 'oauth') return;
    client.assertOrigin(credential);
    auth.set(HOSTED_PROVIDER, { ...credential, pendingRevocation: true });
    try {
      if (durablePath !== undefined) markPendingRevocation(durablePath, credential);
      notify('Outfitter sign-out pending: revoking the session on the server…', 'info');
    } catch {
      notify(
        'Outfitter sign-out pending, but it could not be saved for retry. Keep Pi open until it completes, or run /outfitter-logout.',
        'error',
      );
    }
    void revokeAll(client, durablePath, credential)
      .then((revoked) => {
        auth.reload();
        const current = auth.get(HOSTED_PROVIDER);
        if (current?.type === 'oauth' && current.access === credential.access) original(HOSTED_PROVIDER);
        if (durablePath !== undefined) forgetDurable(durablePath, revoked);
        notify('Outfitter session revoked.', 'info');
      })
      .catch(() => {
        notify(
          'Outfitter remote logout failed. Credentials are retained for revocation retry; run /outfitter-logout.',
          'error',
        );
      });
  };
  auth.logout = (provider) => {
    if (provider !== HOSTED_PROVIDER) original(provider);
    else revoke();
  };
  const credential = auth.get(HOSTED_PROVIDER);
  if (credential?.type === 'oauth' && credential.pendingRevocation === true) revoke();
};
