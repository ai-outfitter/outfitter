import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePiUserAgentDirectory } from '../agents/PiCredentialPersistence.js';
import { hostedOrigin } from '../hosted/HostedClient.js';
import type { TelemetryEnvironment } from './TelemetryConsent.js';

export interface TelemetryIdentity {
  readonly userId: string;
  readonly email?: string;
  readonly workspaceId: string;
  readonly workspaceType: 'User' | 'Organization';
}
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const parseIdentity = (value: unknown): TelemetryIdentity | undefined => {
  const data = object(value);
  const user = object(data.user);
  const workspace = object(data.workspace);
  if (typeof user.id !== 'string' || !/^github:\d+$/u.test(user.id)) return undefined;
  if (typeof workspace.id !== 'string' || !/^(user|org):\d+$/u.test(workspace.id)) return undefined;
  if (workspace.type !== 'User' && workspace.type !== 'Organization') return undefined;
  return {
    userId: user.id,
    email: typeof user.email === 'string' ? user.email : undefined,
    workspaceId: workspace.id,
    workspaceType: workspace.type,
  };
};

/** Called only after telemetry consent. Reads but never refreshes or changes inference credentials. */
export const readHostedTelemetryIdentity = async (
  homeDirectory: string,
  env: TelemetryEnvironment,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<TelemetryIdentity | undefined> => {
  try {
    const stored: unknown = JSON.parse(
      readFileSync(join(resolvePiUserAgentDirectory(homeDirectory), 'auth.json'), 'utf8'),
    );
    const credential = object(object(stored).outfitter);
    const origin = hostedOrigin(env.OUTFITTER_API_ORIGIN);
    if (credential.type !== 'oauth' || credential.origin !== origin || typeof credential.access !== 'string')
      return undefined;
    if (typeof credential.expires !== 'number' || credential.expires <= Date.now()) return undefined;
    const signal = AbortSignal.timeout(250);
    const request = async (): Promise<TelemetryIdentity | undefined> => {
      const response = await fetcher(`${origin}/api/cli/me`, {
        headers: { Authorization: `Bearer ${credential.access as string}` },
        redirect: 'error',
        signal,
      });
      return response.ok ? parseIdentity(await response.json()) : undefined;
    };
    return await Promise.race([
      request(),
      new Promise<undefined>((resolve) => signal.addEventListener('abort', () => resolve(undefined), { once: true })),
    ]);
  } catch {
    return undefined;
  }
};
