// Resolves whether Claude Code reads the user's native configuration or an isolated projection.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLAUDE_ISOLATION_MODES = ['inherit', 'isolated'] as const;
export type ClaudeIsolationMode = (typeof CLAUDE_ISOLATION_MODES)[number];

export const resolveClaudeConfigStrategy = (
  settingsDefault: ClaudeIsolationMode | undefined,
  requested: ClaudeIsolationMode | undefined,
): ClaudeIsolationMode => requested ?? settingsDefault ?? 'inherit';

/** Returns the flags missing from the installed Claude build for inherited configuration. */
export const missingClaudeInheritanceFlags = (help: string): readonly string[] =>
  ['--plugin-dir'].filter((flag) => !help.includes(flag));

const readObject = (path: string): Readonly<Record<string, unknown>> => {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  } catch {
    return {};
  }
};

const objectSize = (value: unknown): number =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value).length : 0;

/** One inspectable startup summary of the machine-local state inherited by Claude. */
export const describeInheritedClaudeConfiguration = (homeDirectory: string): string => {
  const settingsPath = join(homeDirectory, '.claude', 'settings.json');
  const settings = readObject(settingsPath);
  const state = readObject(join(homeDirectory, '.claude.json'));
  return `Claude configuration: inherited ${existsSync(settingsPath) ? settingsPath : 'no user settings file'}, ${objectSize(state.mcpServers)} user MCP servers, ${objectSize(settings.enabledPlugins)} enabled plugins.`;
};

/** Probes the installed harness once before launch; an unavailable/old build cannot inherit safely. */
export const probeClaudeInheritance = (): readonly string[] => {
  const result = spawnSync('claude', ['--help'], { encoding: 'utf8' });
  if (result.error !== undefined || result.status !== 0) return ['--plugin-dir'];
  return missingClaudeInheritanceFlags(`${result.stdout}${result.stderr}`);
};
