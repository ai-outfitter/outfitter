import { homedir } from 'node:os';
import { join } from 'node:path';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { resolvePiUserAgentDirectory } from '../agents/PiCredentialPersistence.js';
import { HostedClient } from './HostedClient.js';
import { HostedSession } from './HostedSession.js';
import type { Credentials, ProviderConfig } from './HostedClient.js';

/** Bundled extension; opt-in until the hosted service is released. Never selects a model for the user. */
export default async function outfitterProvider(pi: ExtensionAPI): Promise<void> {
  if (process.env.OUTFITTER_HOSTED_INFERENCE !== '1') return;
  const client = new HostedClient({ origin: process.env.OUTFITTER_API_ORIGIN });
  const directory = process.env.PI_CODING_AGENT_DIR ?? resolvePiUserAgentDirectory(homedir());
  const auth = AuthStorage.create(join(directory, 'auth.json'));
  const session = new HostedSession(client, auth);
  const register = (models: ProviderConfig['models']) =>
    pi.registerProvider('outfitter', client.provider(models, discover));
  const discover = async (credentials: Credentials): Promise<void> => {
    register(await client.models(credentials.access));
  };
  const refresh = async () => {
    const models = await client.models(await session.access());
    register(models);
    return models;
  };
  pi.registerCommand('outfitter-logout', {
    description: 'Revoke the Outfitter device session and remove its credentials.',
    handler: async (_args, ctx) => {
      await session.logout();
      register([]);
      ctx.ui.notify('Signed out of Outfitter.', 'info');
    },
  });
  pi.registerCommand('outfitter-workspace', {
    description: 'Select an Outfitter workspace and refresh its models.',
    handler: async (args, ctx) => {
      const id = args.trim();
      if (!id) throw new Error('Usage: /outfitter-workspace <workspace-id>');
      const identity = await session.workspace(id);
      await refresh();
      ctx.ui.notify(`Outfitter workspace: ${identity.workspace.login} (${identity.workspace.id})`, 'info');
    },
  });
  pi.on('before_agent_start', async (_event, ctx) => {
    if (ctx.model?.provider !== 'outfitter') return;
    try {
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
  register([]);
  const credentials = auth.get('outfitter');
  if (credentials?.type === 'oauth') {
    await refresh();
  }
}
