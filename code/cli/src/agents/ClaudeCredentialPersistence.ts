// Persists Claude Code credentials across runs. CLAUDE_CONFIG_DIR points Claude at an ephemeral
// projection root, but its durable Claude and MCP OAuth credentials normally live in
// ~/.claude/.credentials.json while account metadata, onboarding state, and workspace trust live in
// ~/.claude.json. Seed only the required top-level state and the current workspace's existing trust
// decision; merge credential changes back without exposing or replacing the rest of Claude's
// machine-local state.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CREDENTIALS_FILE = '.credentials.json';
const STATE_FILE = '.claude.json';
const CREDENTIAL_MODE = 0o600;

type JsonObject = Record<string, unknown>;

const hashFile = (path: string): string | undefined => {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return undefined;
  }
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const readJsonObject = (path: string): JsonObject | undefined => {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isJsonObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

export const atomicReplace = (
  destinationPath: string,
  fillTemporary: (temporaryPath: string) => void,
  shouldReplace: () => boolean = () => true,
): boolean => {
  const destinationDirectory = dirname(destinationPath);
  mkdirSync(destinationDirectory, { recursive: true });
  const temporaryPath = join(destinationDirectory, `.outfitter-${randomUUID()}`);

  try {
    fillTemporary(temporaryPath);
    if (!shouldReplace()) return false;
    renameSync(temporaryPath, destinationPath);
    return true;
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const atomicCopy = (sourcePath: string, destinationPath: string, shouldReplace?: () => boolean): boolean => {
  if (!existsSync(sourcePath)) return false;
  return atomicReplace(
    destinationPath,
    (temporaryPath) => {
      writeFileSync(temporaryPath, readFileSync(sourcePath), { mode: CREDENTIAL_MODE });
    },
    shouldReplace,
  );
};

const atomicWriteJson = (path: string, value: JsonObject): void => {
  atomicReplace(path, (temporaryPath) => {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: CREDENTIAL_MODE });
  });
};

/** Claude's durable configuration directory (`~/.claude`). */
const resolveClaudeUserConfigDirectory = (homeDirectory: string): string => join(homeDirectory, '.claude');

/** Claude's durable machine-local state file (`~/.claude.json`). */
const resolveClaudeUserStatePath = (homeDirectory: string): string => join(homeDirectory, STATE_FILE);

const persistCredentialFile = (
  projectionRoot: string,
  homeDirectory: string,
  seededCredentialsHash?: string,
): string | undefined => {
  const projectionCredentialsPath = join(projectionRoot, CREDENTIALS_FILE);
  const projectedCredentialsHash = hashFile(projectionCredentialsPath);
  if (projectedCredentialsHash === undefined || projectedCredentialsHash === seededCredentialsHash) return undefined;

  const durableCredentialsPath = join(resolveClaudeUserConfigDirectory(homeDirectory), CREDENTIALS_FILE);
  if (hashFile(durableCredentialsPath) !== seededCredentialsHash) {
    // Both this run and another process changed the credentials since seeding. The durable copy
    // is the newer refresh; overwriting it with this projection would revert it.
    return 'Warning: durable Claude credentials changed during the run; skipped the credential copy-back to preserve the concurrent refresh.';
  }

  // Re-check after staging, immediately before the rename. A native Claude writer does not honor
  // our staging protocol, so without cross-process locking an irreducible race remains; this
  // narrows that window to the single rename operation.
  const replaced = atomicCopy(
    projectionCredentialsPath,
    durableCredentialsPath,
    () => hashFile(durableCredentialsPath) === seededCredentialsHash,
  );
  return replaced
    ? undefined
    : 'Warning: durable Claude credentials changed during the run; skipped the credential copy-back to preserve the concurrent refresh.';
};

/** Seeds credentials, onboarding/account state, and the current workspace's trust decision. */
export const seedClaudeCredentials = (
  projectionRoot: string,
  homeDirectory: string,
  workingDirectory: string,
): string | undefined => {
  const projectionCredentialsPath = join(projectionRoot, CREDENTIALS_FILE);
  atomicCopy(join(resolveClaudeUserConfigDirectory(homeDirectory), CREDENTIALS_FILE), projectionCredentialsPath);
  const seededCredentialsHash = hashFile(projectionCredentialsPath);

  const durableState = readJsonObject(resolveClaudeUserStatePath(homeDirectory));
  if (durableState === undefined) return seededCredentialsHash;

  const seededState: JsonObject = {};
  if (Object.hasOwn(durableState, 'oauthAccount')) seededState.oauthAccount = durableState.oauthAccount;
  if (Object.hasOwn(durableState, 'hasCompletedOnboarding')) {
    seededState.hasCompletedOnboarding = durableState.hasCompletedOnboarding;
  }

  const projects = durableState.projects;
  const project = isJsonObject(projects) ? projects[workingDirectory] : undefined;
  if (isJsonObject(project) && project.hasTrustDialogAccepted === true) {
    seededState.projects = { [workingDirectory]: { hasTrustDialogAccepted: true } };
  }

  if (Object.keys(seededState).length > 0) {
    atomicWriteJson(join(projectionRoot, STATE_FILE), seededState);
  }

  return seededCredentialsHash;
};

/**
 * Copies changed credentials back and atomically merges account metadata into durable state.
 * Returns a warning when a concurrent writer changed the durable credentials during the run, in
 * which case the copy-back is skipped so the newer concurrent refresh is not overwritten.
 */
export const persistClaudeCredentials = (
  projectionRoot: string,
  homeDirectory: string,
  seededCredentialsHash?: string,
): string | undefined => {
  const warning = persistCredentialFile(projectionRoot, homeDirectory, seededCredentialsHash);

  const projectionState = readJsonObject(join(projectionRoot, STATE_FILE));
  if (projectionState === undefined || !Object.hasOwn(projectionState, 'oauthAccount')) return warning;

  const durableStatePath = resolveClaudeUserStatePath(homeDirectory);
  const durableState = readJsonObject(durableStatePath);
  if (durableState === undefined && existsSync(durableStatePath)) return warning;
  if (JSON.stringify(projectionState.oauthAccount) === JSON.stringify(durableState?.oauthAccount)) return warning;

  atomicWriteJson(durableStatePath, { ...(durableState ?? {}), oauthAccount: projectionState.oauthAccount });
  return warning;
};
