import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { resolvePiUserAgentDirectory } from '../agents/PiCredentialPersistence.js';
import { installPiLogout } from './PiLogout.js';
import { HostedClient } from './HostedClient.js';
import { hostedSettings, providerOptInMessage } from './ExperimentalProvider.js';
import { HOSTED_PROVIDER } from './DurableCredentials.js';
import { HostedSession } from './HostedSession.js';
import type { Credentials, ProviderConfig } from './HostedClient.js';

/** Bundled extension; opt-in until the hosted service is released. Never selects a model for the user. */
export default async function outfitterProvider(pi: ExtensionAPI): Promise<void> {
  const { enabled, origin } = hostedSettings(homedir());
  const client = new HostedClient({ origin });
  const durablePath = join(resolvePiUserAgentDirectory(homedir()), 'auth.json');
  const authPath = join(process.env.PI_CODING_AGENT_DIR ?? resolvePiUserAgentDirectory(homedir()), 'auth.json');
  // Outfitter runs Pi on a per-run copy; refreshes then go through the durable file.
  const durable = resolve(authPath) === resolve(durablePath) ? undefined : durablePath;
  const auth = AuthStorage.create(authPath);
  const session = () => new HostedSession(client, auth, durable);
  const register = (models: ProviderConfig['models']) =>
    pi.registerProvider(HOSTED_PROVIDER, session().provider(models, discover));
  const discover = async (credentials: Credentials): Promise<void> => {
    register(await client.models(credentials.access));
  };
  const refresh = async () => {
    const models = await client.models(await session().access());
    register(models);
    return models;
  };
  pi.on('session_start', (_event, ctx) => {
    installPiLogout(ctx.modelRegistry.authStorage, client, (message, type) => ctx.ui.notify(message, type), durable);
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
    if (ctx.model?.provider !== HOSTED_PROVIDER) return;
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
  const credentials = auth.get(HOSTED_PROVIDER);
  if (credentials?.type === 'oauth' && credentials.pendingRevocation !== true) {
    await refresh().catch(() => undefined);
  }
}
