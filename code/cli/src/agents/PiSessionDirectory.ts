// Keeps pi session transcripts durable across runs. Outfitter launches pi with PI_CODING_AGENT_DIR
// pointed at a per-run projection root that is deleted once the child exits, and pi stores sessions
// under `<agent dir>/sessions/<encoded cwd>` by default (pi-coding-agent core/session-manager.js:
// getDefaultSessionDirPath()). Left alone every transcript dies with the projection, so
// `pi --continue`/`--resume` can never find the previous conversation (#223).
//
// Outfitter therefore points pi at the same per-project folder under pi's durable agent directory
// that a standalone pi already writes to, so history is shared between `outfitter run` and a bare
// `pi` in the same project, and `--continue` keeps pi's fast path instead of scanning every
// project's transcripts.
import { join, resolve } from 'node:path';

import { resolvePiUserAgentDirectory } from './PiCredentialPersistence.js';

/**
 * pi's session-storage environment override. pi resolves the session directory as
 * `--session-dir` → `PI_CODING_AGENT_SESSION_DIR` → `sessionDir` in settings.json, so a
 * pass-through `-- --session-dir <dir>` still wins over the default Outfitter sets here.
 */
export const PI_SESSION_DIRECTORY_ENV = 'PI_CODING_AGENT_SESSION_DIR';

// pi's own encoding of a project directory into a single session folder name: absolute path,
// leading separator dropped, remaining separators and drive colons flattened to '-', wrapped in
// '--'. Mirrored here so Outfitter runs share pi's native per-project folder rather than starting a
// parallel layout.
const encodeProjectDirectory = (projectDirectory: string): string =>
  `--${resolve(projectDirectory)
    .replace(/^[/\\]/u, '')
    .replace(/[/\\:]/gu, '-')}--`;

/** pi's durable session folder for one project: `~/.pi/agent/sessions/--<encoded project>--`. */
export const resolvePiUserSessionDirectory = (homeDirectory: string, projectDirectory: string): string =>
  join(resolvePiUserAgentDirectory(homeDirectory), 'sessions', encodeProjectDirectory(projectDirectory));

/**
 * Session directory for a pi launch, or `undefined` when the launch should keep whatever
 * `PI_CODING_AGENT_SESSION_DIR` it inherits — an explicitly configured store, such as a resident
 * agent's workspace/PVC path, stays in control. `env`, `homeDirectory`, and `projectDirectory` are
 * injected so the resolution stays unit-testable; `projectDirectory` is the directory pi runs in
 * (`process.cwd()`), which is what makes the result pi's own folder for the project.
 */
export const resolvePiSessionDirectory = (
  env: Readonly<Record<string, string | undefined>>,
  homeDirectory: string,
  projectDirectory: string,
): string | undefined => {
  const inherited = env[PI_SESSION_DIRECTORY_ENV];
  if (inherited !== undefined && inherited.trim() !== '') return undefined;

  return resolvePiUserSessionDirectory(homeDirectory, projectDirectory);
};
