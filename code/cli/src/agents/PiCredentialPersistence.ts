// Persists pi credential/provider state across runs. Outfitter launches pi with PI_CODING_AGENT_DIR
// pointed at an ephemeral, profile-scoped projection root (OFTR-006.3.1/006.4), which pi also uses
// as the home for auth.json/models.json (pi-coding-agent config.js: getAgentDir()). Left alone, a
// /login inside that session would be discarded when the projection root is deleted after the run,
// so the auto sign-in prompt could never converge. To keep provider credentials durable — matching
// standalone pi and pre-#165 Outfitter — we seed the projection root from pi's persistent agent dir
// before launch and copy any changes back afterward.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Files that carry pi credentials and provider/model definitions. Both live in getAgentDir() and
// must survive across the ephemeral projection root.
const persistentPiStateFiles = ['auth.json', 'models.json'] as const;

/** pi's persistent agent directory (`~/.pi/agent`), the durable home for credentials. */
export const resolvePiUserAgentDirectory = (homeDirectory: string): string => join(homeDirectory, '.pi', 'agent');

const copyIfPresent = (sourcePath: string, destinationPath: string): void => {
  if (!existsSync(sourcePath)) return;
  mkdirSync(join(destinationPath, '..'), { recursive: true });
  copyFileSync(sourcePath, destinationPath);
};

/** Seeds durable state without replacing a models.json already projected from the canonical registry. */
export const seedPiCredentials = (projectionRoot: string, piUserAgentDirectory: string): void => {
  for (const file of persistentPiStateFiles) {
    const destination = join(projectionRoot, file);
    if (file === 'models.json' && existsSync(destination)) continue;
    copyIfPresent(join(piUserAgentDirectory, file), destination);
  }
};

// The Outfitter provider rotates its refresh token on every refresh, and its refreshes write the
// durable auth.json directly (hosted/DurableCredentials.ts). A run that exits later with an older
// copy must not put a replaced refresh token back: the server revokes the session when it is reused.
const rotatingProvider = 'outfitter';

type AuthEntry = { type?: string; expires?: number };

/** Whether the durable file holds a newer Outfitter credential than the run's copy. */
const durableIsFresher = (session: Record<string, AuthEntry>, durable: Record<string, AuthEntry>): boolean => {
  const kept = durable[rotatingProvider];
  const copied = session[rotatingProvider];
  if (kept?.type !== 'oauth') return false;
  // Absent here but present there: another run signed in, or this run's logout already removed both.
  return copied === undefined || (copied.type === 'oauth' && (kept.expires ?? 0) > (copied.expires ?? 0));
};

/**
 * Writes the run's auth.json back, keeping a fresher Outfitter rotation. Byte-for-byte when nothing
 * is kept; this module stays free of the Pi runtime so CLI startup does not load it.
 */
const persistAuth = (sessionPath: string, durablePath: string): void => {
  if (!existsSync(sessionPath)) return;
  const text = readFileSync(sessionPath, 'utf8');
  let session: Record<string, AuthEntry>;
  let durable: Record<string, AuthEntry> = {};
  try {
    session = JSON.parse(text) as Record<string, AuthEntry>;
    if (existsSync(durablePath)) durable = JSON.parse(readFileSync(durablePath, 'utf8')) as Record<string, AuthEntry>;
  } catch {
    copyIfPresent(sessionPath, durablePath);
    return;
  }
  if (!durableIsFresher(session, durable)) {
    copyIfPresent(sessionPath, durablePath);
    return;
  }
  const merged = { ...session, [rotatingProvider]: durable[rotatingProvider] };
  writeFileSync(durablePath, JSON.stringify(merged, null, 2), { mode: 0o600 });
};

/** Copies session state back; a catalog-projected models.json is declared config, not user state. */
export const persistPiCredentials = (
  projectionRoot: string,
  piUserAgentDirectory: string,
  persistModels = true,
): void => {
  for (const file of persistentPiStateFiles) {
    if (file === 'models.json' && !persistModels) continue;
    if (file === 'auth.json') persistAuth(join(projectionRoot, file), join(piUserAgentDirectory, file));
    else copyIfPresent(join(projectionRoot, file), join(piUserAgentDirectory, file));
  }
};
