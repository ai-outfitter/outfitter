// Resolves the native configuration directory of each harness that `outfitter link` can manage.
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

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

const onPath = (harness: LinkHarness, env: Readonly<Record<string, string | undefined>>): boolean =>
  (env.PATH ?? '').split(delimiter).some((directory) => directory !== '' && existsSync(join(directory, harness)));

/**
 * A harness counts as installed when its executable is on `PATH` or its home already exists. Every
 * supported harness creates its home on first launch, so a directory check alone would skip a
 * harness installed minutes ago.
 */
export const detectInstalledHarnesses = (
  homeDirectory: string,
  env: Readonly<Record<string, string | undefined>>,
): readonly LinkHarness[] =>
  linkHarnesses.filter(
    (harness) => onPath(harness, env) || existsSync(resolveHarnessHome(harness, homeDirectory, env)),
  );
