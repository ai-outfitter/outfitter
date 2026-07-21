// Persists pi credential/provider state across runs. Outfitter launches pi with PI_CODING_AGENT_DIR
// pointed at an ephemeral, profile-scoped projection root (OFTR-006.3.1/006.4), which pi also uses
// as the home for auth.json/models.json (pi-coding-agent config.js: getAgentDir()). Left alone, a
// /login inside that session would be discarded when the projection root is deleted after the run,
// so the auto sign-in prompt could never converge. To keep provider credentials durable — matching
// standalone pi and pre-#165 Outfitter — we seed the projection root from pi's persistent agent dir
// before launch and copy any changes back afterward.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
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

/** Seeds the projection root with the user's existing pi credentials so pi sees them at startup. */
export const seedPiCredentials = (projectionRoot: string, piUserAgentDirectory: string): void => {
  for (const file of persistentPiStateFiles) {
    copyIfPresent(join(piUserAgentDirectory, file), join(projectionRoot, file));
  }
};

/** Copies credentials created or changed during the pi session back to the durable agent dir. */
export const persistPiCredentials = (projectionRoot: string, piUserAgentDirectory: string): void => {
  for (const file of persistentPiStateFiles) {
    copyIfPresent(join(projectionRoot, file), join(piUserAgentDirectory, file));
  }
};
