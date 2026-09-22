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
  register([]);
  const credentials = auth.get('outfitter');
  if (credentials?.type === 'oauth') {
    register(await client.models(await session.access()));
  }
}
