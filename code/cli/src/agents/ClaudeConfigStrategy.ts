// Decides whether a Claude Code run stands on the user's own ~/.claude configuration or on the
// projection alone. Inheriting is the default because a profile is a costume, not a new machine:
// the composition should win where it speaks — identity, skills, subagents, selected MCP servers,
// model, tool restrictions — while trust, permissions, credentials, and the user's own MCP servers
// and plugins keep applying where it is silent. Isolation stays reachable for reproducible CI and
// container runs, and is forced when the installed Claude is too old to inherit safely.
import { spawnSync } from 'node:child_process';

import type { Isolation } from '../settings/Settings.js';
import { ISOLATIONS } from '../settings/Settings.js';

/** CLI flags inheriting depends on. A Claude without them cannot load the composition at all. */
const REQUIRED_INHERIT_FLAGS = ['--plugin-dir', '--mcp-config'] as const;

/** Reads a harness CLI's own help text. Replaced in tests; probing the real binary is the default. */
export type HarnessHelpReader = (command: string) => string | undefined;

export interface ClaudeConfigDecision {
  readonly isolation: Isolation;
  /** Emitted when the decision differs from what was asked for, so a surprise is never silent. */
  readonly warning?: string;
}

export const resolveIsolation = (settingsDefault: Isolation | undefined, requestedIsolated: boolean): Isolation => {
  if (requestedIsolated) return 'isolated';

  const isolation = settingsDefault ?? 'inherit';

  /* v8 ignore next -- schema validation rejects other values before settings reach this point. */
  if (!ISOLATIONS.includes(isolation)) throw new Error(`Unknown isolation '${isolation}'.`);

  return isolation;
};

/* v8 ignore start -- spawns the real harness binary; every caller takes an injected reader in tests. */
const readHarnessHelp: HarnessHelpReader = (command) => {
  const result = spawnSync(command, ['--help'], { encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 ? result.stdout : undefined;
};
/* v8 ignore stop */

/**
 * Inheriting carries the composition on session-only flags rather than a configuration directory,
 * so an unrecognized flag would be a hard launch failure rather than a degraded session. Probe the
 * installed CLI and fall back to the isolated projection, loudly, when a flag is missing.
 */
export const decideClaudeConfigStrategy = (
  requested: Isolation,
  readHelp: HarnessHelpReader = readHarnessHelp,
): ClaudeConfigDecision => {
  if (requested === 'isolated') return { isolation: 'isolated' };

  const help = readHelp('claude');

  if (help === undefined) {
    return {
      isolation: 'isolated',
      warning:
        'Warning: could not read `claude --help` to confirm it can load a profile over your own configuration; ' +
        'falling back to an isolated run.',
    };
  }

  const missing = REQUIRED_INHERIT_FLAGS.filter((flag) => !help.includes(flag));

  if (missing.length > 0) {
    return {
      isolation: 'isolated',
      warning:
        `Warning: this Claude Code does not support ${missing.join(', ')}, so it cannot run a profile over your ` +
        'own configuration; falling back to an isolated run. Update Claude Code to inherit trust, permissions, ' +
        'MCP servers, and plugins.',
    };
  }

  return { isolation: 'inherit' };
};
