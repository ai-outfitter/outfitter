// Claude authentication stays inside Claude Code. Interactive launches with no detectable login
// state get a one-line handoff to Claude's native /login flow; Outfitter never reads credentials.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const claudeLoginHintMessage =
  'Claude Code manages its own credentials; if it reports that you are not logged in, run `/login` inside ' +
  'Claude Code. Outfitter never reads or stores Claude credentials.';

const isPrintMode = (args: readonly string[]): boolean => args.some((arg) => arg === '--print' || arg === '-p');

export const hasConfiguredClaudeLoginState = (homeDirectory: string): boolean => {
  if (existsSync(join(homeDirectory, '.claude', '.credentials.json'))) return true;

  const configPath = join(homeDirectory, '.claude.json');
  if (!existsSync(configPath)) return false;

  try {
    const value: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const config = value as Readonly<Record<string, unknown>>;
    return config.oauthAccount !== undefined || config.primaryApiKey !== undefined;
  } catch {
    return false;
  }
};

export const resolveClaudeLoginHint = (input: {
  readonly harness: string;
  readonly homeDirectory: string;
  readonly passThroughArgs: readonly string[];
  readonly interactive: boolean;
}): string | undefined => {
  if (input.harness !== 'claude' || !input.interactive || isPrintMode(input.passThroughArgs)) return undefined;
  return hasConfiguredClaudeLoginState(input.homeDirectory) ? undefined : claudeLoginHintMessage;
};
