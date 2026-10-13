import { homedir } from 'node:os';
import { join } from 'node:path';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { resolvePiUserAgentDirectory } from '../agents/PiCredentialPersistence.js';
import { installPiLogout } from './PiLogout.js';
import { HostedClient } from './HostedClient.js';
import { experimentalProviderEnabled, providerOptInMessage } from './ExperimentalProvider.js';
import { HostedSession } from './HostedSession.js';
import type { Credentials, ProviderConfig } from './HostedClient.js';

/** Bundled extension; opt-in until the hosted service is released. Never selects a model for the user. */
export default async function outfitterProvider(pi: ExtensionAPI): Promise<void> {
  const enabled = experimentalProviderEnabled(homedir());
  const client = new HostedClient();
  const directory = process.env.PI_CODING_AGENT_DIR ?? resolvePiUserAgentDirectory(homedir());
  const auth = AuthStorage.create(join(directory, 'auth.json'));
  const session = () => new HostedSession(client, auth);
  const register = (models: ProviderConfig['models']) =>
    pi.registerProvider('outfitter', session().provider(models, discover));
  const discover = async (credentials: Credentials): Promise<void> => {
    register(await client.models(credentials.access));
  };
  const refresh = async () => {
    const models = await client.models(await session().access());
    register(models);
    return models;
  };
  pi.on('session_start', (_event, ctx) => {
    installPiLogout(ctx.modelRegistry.authStorage, client, (message, type) => ctx.ui.notify(message, type));
  });
  pi.registerCommand('outfitter-logout', {
    description: 'Revoke the Outfitter device session and remove its credentials.',
    handler: async (_args, ctx) => {
      await session().logout();
      if (enabled) register([]);
      ctx.ui.notify('Signed out of Outfitter.', 'info');
    },
  });
  pi.on('before_agent_start', async (_event, ctx) => {
    if (ctx.model?.provider !== 'outfitter') return;
    try {
      if (!enabled) throw new Error(providerOptInMessage);
      const models = await refresh();
      if (!models.some((model) => model.id === ctx.model!.id)) throw new Error('Unavailable model');
    } catch {
      ctx.abort();
      ctx.ui.notify(
        'Outfitter access or selected model is unavailable. Sign in or select an available model.',
        'error',
      );
    }
  });
  if (!enabled) return;
  register([]);
  const credentials = auth.get('outfitter');
  if (credentials?.type === 'oauth' && credentials.pendingRevocation !== true) {
    await refresh();
  }
}
