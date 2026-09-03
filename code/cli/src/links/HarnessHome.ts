// Resolves the native configuration directory of each harness that `outfitter link` can manage.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Harnesses with a persistent home directory that Outfitter can populate with managed links. */
export type LinkHarness = 'claude' | 'codex';

export const linkHarnesses: readonly LinkHarness[] = ['claude', 'codex'];

export const isLinkHarness = (value: string): value is LinkHarness =>
  (linkHarnesses as readonly string[]).includes(value);

/**
 * Claude Code reads `CLAUDE_CONFIG_DIR` and Codex reads `CODEX_HOME` before their defaults, so a
 * link must land wherever the harness will actually look.
 */
export const resolveHarnessHome = (
  harness: LinkHarness,
  homeDirectory: string,
  env: Readonly<Record<string, string | undefined>>,
): string => {
  const override = harness === 'claude' ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME;
  if (override !== undefined && override.trim() !== '') return override;
  return join(homeDirectory, harness === 'claude' ? '.claude' : '.codex');
};

/** Harnesses whose home directory already exists, so linking into it targets an installed harness. */
export const detectInstalledHarnesses = (
  homeDirectory: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly LinkHarness[] =>
  linkHarnesses.filter((harness) => existsSync(resolveHarnessHome(harness, homeDirectory, env)));
