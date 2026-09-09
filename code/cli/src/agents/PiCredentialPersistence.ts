// Persists pi credential/provider state across runs. Outfitter launches pi with PI_CODING_AGENT_DIR
// pointed at an ephemeral, profile-scoped projection root (OFTR-006.3.1/006.4), which pi also uses
// as the home for auth.json/models.json (pi-coding-agent config.js: getAgentDir()). Left alone, a
// /login inside that session would be discarded when the projection root is deleted after the run,
// so the auto sign-in prompt could never converge. To keep provider credentials durable — matching
// standalone pi and pre-#165 Outfitter — we seed the projection root from pi's persistent agent dir
// before launch and copy any changes back afterward.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { join } from 'node:path';

// Files that carry pi credentials and provider/model definitions. Both live in getAgentDir() and
// must survive across the ephemeral projection root.
const persistentPiStateFiles = ['auth.json', 'models.json'] as const;

export interface SeededPiCredentials {
  readonly authJson: string | undefined;
}

type CredentialMap = Record<string, unknown>;

/** pi's persistent agent directory (`~/.pi/agent`), the durable home for credentials. */
export const resolvePiUserAgentDirectory = (homeDirectory: string): string => join(homeDirectory, '.pi', 'agent');

const copyIfPresent = (sourcePath: string, destinationPath: string): void => {
  if (!existsSync(sourcePath)) return;
  mkdirSync(join(destinationPath, '..'), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
};

const readIfPresent = (path: string): string | undefined => (existsSync(path) ? readFileSync(path, 'utf8') : undefined);

const parseCredentialMap = (content: string | undefined, path: string): CredentialMap => {
  if (content === undefined) return {};
  const parsed: unknown = JSON.parse(content);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return parsed as CredentialMap;
};

/** Merge only provider entries changed by this session into the latest durable auth state. */
const persistPiAuth = (projectionPath: string, durablePath: string, seededContent: string | undefined): void => {
  const projectionContent = readIfPresent(projectionPath);
  if (projectionContent === undefined) return;

  const seeded = parseCredentialMap(seededContent, 'seeded auth.json');
  const projection = parseCredentialMap(projectionContent, projectionPath);
  const changedProviders = new Set([...Object.keys(seeded), ...Object.keys(projection)]);
  for (const provider of [...changedProviders]) {
    if (isDeepStrictEqual(seeded[provider], projection[provider])) changedProviders.delete(provider);
  }
  if (changedProviders.size === 0) return;

  const durable = parseCredentialMap(readIfPresent(durablePath), durablePath);
  for (const provider of changedProviders) {
    if (Object.hasOwn(projection, provider)) durable[provider] = projection[provider];
    else delete durable[provider];
  }
  mkdirSync(join(durablePath, '..'), { recursive: true });
  writeFileSync(durablePath, `${JSON.stringify(durable, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(durablePath, 0o600);
};

/** Seeds durable state without replacing a models.json already projected from the canonical registry. */
export const seedPiCredentials = (projectionRoot: string, piUserAgentDirectory: string): SeededPiCredentials => {
  const authJson = readIfPresent(join(piUserAgentDirectory, 'auth.json'));
  for (const file of persistentPiStateFiles) {
    const destination = join(projectionRoot, file);
    if (file === 'models.json' && existsSync(destination)) continue;
    copyIfPresent(join(piUserAgentDirectory, file), destination);
  }
  return { authJson };
};

/** Copies session state back; a catalog-projected models.json is declared config, not user state. */
export const persistPiCredentials = (
  projectionRoot: string,
  piUserAgentDirectory: string,
  persistModels = true,
  seeded?: SeededPiCredentials,
): void => {
  for (const file of persistentPiStateFiles) {
    if (file === 'models.json' && !persistModels) continue;
    if (file === 'auth.json' && seeded !== undefined) {
      persistPiAuth(join(projectionRoot, file), join(piUserAgentDirectory, file), seeded.authJson);
      continue;
    }
    copyIfPresent(join(projectionRoot, file), join(piUserAgentDirectory, file));
  }
};
