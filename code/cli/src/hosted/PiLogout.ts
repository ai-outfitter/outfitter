import type { AuthStorage } from '@earendil-works/pi-coding-agent';
import { HostedClient } from './HostedClient.js';

/** Pi's native logout is synchronous. Keep a durable retry marker until remote revocation succeeds. */
export const installPiLogout = (
  auth: AuthStorage,
  client: HostedClient,
  notify: (message: string, type: 'info' | 'error') => void,
): void => {
  const original = auth.logout.bind(auth);
  const revoke = (): void => {
    const credential = auth.get('outfitter');
    if (credential?.type !== 'oauth') return;
    client.assertOrigin(credential);
    auth.set('outfitter', { ...credential, pendingRevocation: true });
    void client
      .api('/api/cli/logout', credential.access, {}, 'POST')
      .then(() => {
        auth.reload();
        const current = auth.get('outfitter');
        if (current?.type === 'oauth' && current.access === credential.access) original('outfitter');
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
    if (provider !== 'outfitter') original(provider);
    else revoke();
  };
  const credential = auth.get('outfitter');
  if (credential?.type === 'oauth' && credential.pendingRevocation === true) revoke();
};
