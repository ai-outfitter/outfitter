import type { AuthStorage } from '@earendil-works/pi-coding-agent';
import { HOSTED_PROVIDER, forgetDurable, revokeAll } from './DurableCredentials.js';
import { HostedClient } from './HostedClient.js';

/** Pi's native logout is synchronous. Keep a durable retry marker until remote revocation succeeds. */
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
