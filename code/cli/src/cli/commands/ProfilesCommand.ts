// Implements `outfitter profiles`, which makes harness parity inspectable: one line (or one JSON
// object) per compiled profile, reporting how each harness's native projection compares with the
// compiled registry (issue #387).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Command } from 'commander';

import { detectInstalledHarnesses, linkHarnesses, resolveHarnessHome } from '../../links/HarnessHome.js';
import type { LinkHarness } from '../../links/HarnessHome.js';
import { unsupportedProfileElements } from '../../profiles/ProfileProjection.js';
import type { CompiledProfile } from '../../profiles/ProfileCompiler.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

/** How one harness's native projection compares with the compiled registry for one profile. */
export type ProfileParityStatus = 'ready' | 'partial' | 'missing' | 'unavailable';

export interface ProfileParity {
  readonly status: ProfileParityStatus;
  readonly unsupported?: readonly string[];
}

export interface ProfileParityReport {
  readonly agent: string;
  readonly fingerprint: string;
  readonly pi: ProfileParity;
  readonly claude: ProfileParity;
  readonly codex: ProfileParity;
}

interface RegistryDocument {
  readonly profiles: readonly CompiledProfile[];
}

const readCompiledRegistry = (homeDirectory: string): readonly CompiledProfile[] | undefined => {
  const document = asRecord(readRegistry(neutralRegistryPath(homeDirectory)));
  if (document === undefined || !Array.isArray(document.profiles)) return undefined;
  return (document as unknown as RegistryDocument).profiles;
};

export interface ProfilesCommandResult {
  readonly exitCode: number;
  readonly messages: readonly string[];
  readonly report?: readonly ProfileParityReport[];
}

export interface ProfilesCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly json?: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const neutralRegistryPath = (homeDirectory: string): string =>
  join(homeDirectory, '.outfitter', 'profiles', 'registry.json');

const readRegistry = (path: string): unknown => {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Reads the harness's projected fingerprint for one agent from its `outfitter/profiles.json`. */
const projectedFingerprint = (harness: LinkHarness, home: string, agent: string): string | undefined => {
  const document = asRecord(readRegistry(join(home, 'outfitter', 'profiles.json')));
  if (document === undefined || document.harness !== harness || !Array.isArray(document.profiles)) return undefined;
  const entry = document.profiles.find(
    (profile): profile is { agent?: unknown; fingerprint?: unknown } =>
      asRecord(profile) !== undefined && (profile as { agent?: unknown }).agent === agent,
  );
  return typeof entry?.fingerprint === 'string' ? entry.fingerprint : undefined;
};

const piRegistryFingerprint = (home: string, agent: string): string | undefined => {
  const registry = asRecord(readRegistry(join(home, 'outfitter', 'profiles', 'registry.json')));
  if (registry === undefined || !Array.isArray(registry.profiles)) return undefined;
  const profile = registry.profiles.find(
    (candidate): candidate is { fingerprint?: unknown } =>
      asRecord(candidate) !== undefined && (candidate as { agent?: unknown }).agent === agent,
  );
  return typeof profile?.fingerprint === 'string' ? profile.fingerprint : undefined;
};

/**
 * Compares the compiled fingerprint with the harness's projected one. `missing` covers both an
 * absent projection and a stale one: parity means the compiled fingerprint is current.
 */
const parityFor = (harness: LinkHarness, profile: CompiledProfile, home: string | undefined): ProfileParity => {
  if (home === undefined) return { status: 'unavailable' };
  const projected =
    harness === 'pi' ? piRegistryFingerprint(home, profile.agent) : projectedFingerprint(harness, home, profile.agent);
  if (projected === undefined || projected !== profile.fingerprint) return { status: 'missing' };
  const unsupported = unsupportedProfileElements(harness, profile);
  return unsupported.length === 0 ? { status: 'ready' } : { status: 'partial', unsupported };
};

const resolveHomes = (input: ProfilesCommandInput): Readonly<Record<LinkHarness, string | undefined>> => {
  const detected = new Set(detectInstalledHarnesses(input.homeDirectory, input.env));
  const homes = {} as Record<LinkHarness, string | undefined>;
  for (const harness of linkHarnesses) {
    homes[harness] = detected.has(harness) ? resolveHarnessHome(harness, input.homeDirectory, input.env) : undefined;
  }
  return homes;
};

/** Builds the parity report from the compiled registry; undefined when nothing was compiled yet. */
export const buildProfileParityReport = (input: ProfilesCommandInput): readonly ProfileParityReport[] | undefined => {
  const profiles = readCompiledRegistry(input.homeDirectory);
  if (profiles === undefined) return undefined;
  const homes = resolveHomes(input);
  return profiles.map((profile) => ({
    agent: profile.agent,
    fingerprint: profile.fingerprint,
    pi: parityFor('pi', profile, homes.pi),
    claude: parityFor('claude', profile, homes.claude),
    codex: parityFor('codex', profile, homes.codex),
  }));
};

const describeParity = (parity: ProfileParity): string => {
  if (parity.status === 'partial') return `partial (unsupported: ${parity.unsupported!.join(', ')})`;
  return parity.status;
};

const humanLines = (report: readonly ProfileParityReport[]): readonly string[] =>
  report.map(
    (entry) =>
      `${entry.agent} ${entry.fingerprint} pi:${describeParity(entry.pi)} claude:${describeParity(
        entry.claude,
      )} codex:${describeParity(entry.codex)}`,
  );

const noProfilesMessage = "No compiled profiles. Run 'outfitter sync' to compile the enabled agents.";

export const executeProfilesCommand = (input: ProfilesCommandInput): ProfilesCommandResult => {
  const report = buildProfileParityReport(input);
  if (report === undefined) return { exitCode: 0, messages: [noProfilesMessage] };
  if (input.json === true) return { exitCode: 0, messages: [JSON.stringify({ profiles: report }, null, 2)], report };
  return { exitCode: 0, messages: humanLines(report), report };
};

export interface ProfilesCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly writeLine?: (message: string) => void;
}

export const createProfilesCommand = (dependencies: ProfilesCommandDependencies = {}): CommandObject => ({
  name: 'profiles',
  description: 'Report how compiled agent profiles are projected into Pi, Claude Code, and Codex.',
  register(program: Command): void {
    program
      .command('profiles')
      .description('Report how compiled agent profiles are projected into Pi, Claude Code, and Codex.')
      .option('--json', 'Print the parity report as machine-readable JSON.')
      .action((options: { json?: boolean }) => {
        const result = executeProfilesCommand({
          homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
          projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
          json: options.json,
          /* v8 ignore next -- process fallback is direct CLI behavior; tests pass env explicitly. */
          env: dependencies.env ?? process.env,
        });
        for (const message of result.messages) {
          /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
          (dependencies.writeLine ?? console.log)(message);
        }
        /* v8 ignore next 2 -- process exit wiring is covered by CLI smoke behavior. */
        if (result.exitCode !== 0) process.exitCode = result.exitCode;
      });
  },
});
