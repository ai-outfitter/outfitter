// Persists pi credential/provider state across runs. Outfitter launches pi with PI_CODING_AGENT_DIR
// pointed at an ephemeral, profile-scoped projection root (OFTR-006.3.1/006.4), which pi also uses
// as the home for auth.json/models.json (pi-coding-agent config.js: getAgentDir()). Left alone, a
// /login inside that session would be discarded when the projection root is deleted after the run,
// so the auto sign-in prompt could never converge. To keep provider credentials durable — matching
// standalone pi and pre-#165 Outfitter — we seed the projection root from pi's persistent agent dir
// before launch and copy any changes back afterward.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** pi's persistent agent directory (`~/.pi/agent`), the durable home for credentials. */
export const resolvePiUserAgentDirectory = (homeDirectory: string): string => join(homeDirectory, '.pi', 'agent');

const copyIfPresent = (sourcePath: string, destinationPath: string): void => {
  if (!existsSync(sourcePath)) return;
  mkdirSync(join(destinationPath, '..'), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
};

// The Outfitter provider rotates its refresh token on every refresh, and its refreshes and native
// logout write the durable auth.json directly, under Pi's file lock (hosted/DurableCredentials.ts).
// A run that exits must not put back what another run rotated away or signed out of: the server
// revokes a session whose replaced refresh token is reused, and a resurrected credential undoes a
// logout. So write-back compares the durable entry with the one this run was seeded with.
const rotatingProvider = 'outfitter';

/** The durable Outfitter entry a run was seeded with; `hosted` is undefined when there was none. */
export interface PiAuthBaseline {
  readonly hosted: string | undefined;
}

type AuthFile = Record<string, unknown>;

/** A key-order-independent identity for an auth entry, including its absence. */
const identity = (entry: unknown): string | undefined =>
  entry === undefined
    ? undefined
    : JSON.stringify(entry, (_key, value: unknown) =>
        value !== null && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value,
      );

const parseAuth = (text: string | undefined): AuthFile | undefined => {
  try {
    const data: unknown = text?.trim() ? JSON.parse(text) : {};
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as AuthFile) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Seeds durable state without replacing a models.json already projected from the canonical registry.
 * Returns the seeded Outfitter entry for {@link persistPiAuth}.
 */
export const seedPiCredentials = (projectionRoot: string, piUserAgentDirectory: string): PiAuthBaseline => {
  const models = join(projectionRoot, 'models.json');
  if (!existsSync(models)) copyIfPresent(join(piUserAgentDirectory, 'models.json'), models);
  const source = join(piUserAgentDirectory, 'auth.json');
  if (!existsSync(source)) return { hosted: undefined };
  // Read once, so the baseline is exactly what the run starts with.
  const seeded = readFileSync(source, 'utf8');
  mkdirSync(projectionRoot, { recursive: true });
  writeFileSync(join(projectionRoot, 'auth.json'), seeded, { mode: 0o600 });
  return { hosted: identity(parseAuth(seeded)?.[rotatingProvider]) };
};

/**
 * Writes the run's auth.json back under Pi's lock. Other providers are the run's, as before. The
 * Outfitter entry is the run's only if the durable one is still what the run was seeded with;
 * otherwise another run rotated, signed in or signed out meanwhile, and that state is kept,
 * including its absence. Byte-for-byte when the run's entry is kept. Without a baseline the run is
 * treated as seeded with no Outfitter credential. Pi's lock is loaded only here, so CLI startup
 * does not load the Pi runtime.
 */
export const persistPiAuth = async (
  projectionRoot: string,
  piUserAgentDirectory: string,
  baseline: PiAuthBaseline = { hosted: undefined },
): Promise<void> => {
  const sessionPath = join(projectionRoot, 'auth.json');
  if (!existsSync(sessionPath)) return;
  const text = readFileSync(sessionPath, 'utf8');
  const session = parseAuth(text);
  const { FileAuthStorageBackend } = await import('@earendil-works/pi-coding-agent');
  await new FileAuthStorageBackend(join(piUserAgentDirectory, 'auth.json')).withLockAsync((current) => {
    const durable = parseAuth(current);
    if (session === undefined || durable === undefined) return Promise.resolve({ result: undefined, next: text });
    const externallyChanged = identity(durable[rotatingProvider]) !== baseline.hosted;
    const kept = externallyChanged ? durable[rotatingProvider] : session[rotatingProvider];
    if (identity(kept) === identity(session[rotatingProvider]))
      return Promise.resolve({ result: undefined, next: text });
    const merged: AuthFile = { ...session };
    delete merged[rotatingProvider];
    if (kept !== undefined) merged[rotatingProvider] = kept;
    return Promise.resolve({ result: undefined, next: JSON.stringify(merged, null, 2) });
  });
};

/**
 * Copies session models back; a catalog-projected models.json is declared config, not user state.
 * auth.json goes back through {@link persistPiAuth}, under Pi's lock.
 */
export const persistPiCredentials = (
  projectionRoot: string,
  piUserAgentDirectory: string,
  persistModels = true,
): void => {
  if (persistModels) copyIfPresent(join(projectionRoot, 'models.json'), join(piUserAgentDirectory, 'models.json'));
};
