// Ensures the peer dependencies declared by a cached npm extension package are present in the
// extension cache before the package is served. Fresh loaders (pi-subagents child sessions, SDK
// sessions) resolve the entry file's imports from the cache, so a missing peer kills the load there
// even though the main session resolves peers through pi's loader aliases. pi deliberately disables
// peer auto-install for extension packages (`--legacy-peer-deps` / `--omit=peer`), so Outfitter
// installs absent non-optional peers into the cache npm root with npm, mirroring pi's own install
// arguments and resolving the peer's declared range. The satisfied check is a filesystem presence
// test only: a cache hit with satisfied peers performs no spawns and no network, an offline run
// warns instead of installing, and a failed install warns without dropping the extension.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createSpawnLauncher, launchThroughSpawn, spawnLauncher } from '../agents/AgentLaunch.js';

/** Spawns the npm install that satisfies one unmet peer dependency; injectable so tests avoid the network. */
export type PiPeerSpawner = (input: {
  readonly name: string;
  readonly range: string;
  readonly npmRoot: string;
  readonly debug?: boolean;
}) => Promise<number>;

export interface EnsurePeerDependenciesInput {
  /** The extension specifier, for warning messages. */
  readonly specifier: string;
  readonly installDir: string;
  /** The cache npm project root (`<cacheAgentDir>/npm`) peers install into. */
  readonly npmRoot: string;
  readonly offline: boolean;
  readonly debug?: boolean;
  readonly peerSpawn?: PiPeerSpawner;
}

/* v8 ignore start -- real npm subprocess; ensurePeerDependencies is unit-tested with a fake spawner. */
const quietSpawnLauncher = createSpawnLauncher('ignore');
const defaultPeerSpawner: PiPeerSpawner = ({ name, range, npmRoot, debug }) =>
  launchThroughSpawn(debug === true ? spawnLauncher : quietSpawnLauncher, {
    command: 'npm',
    args: ['install', `${name}@${range}`, '--prefix', npmRoot, '--legacy-peer-deps'],
    env: { GIT_TERMINAL_PROMPT: '0' },
  });
/* v8 ignore stop */

interface DeclaredPeers {
  readonly peers: Readonly<Record<string, string>>;
  readonly optional: ReadonlySet<string>;
}

const stringEntries = (value: unknown): Readonly<Record<string, string>> => {
  if (value === null || typeof value !== 'object') return {};
  const entries: Record<string, string> = {};
  for (const [name, range] of Object.entries(value)) {
    if (typeof range === 'string') entries[name] = range;
  }
  return entries;
};

const optionalPeerNames = (value: unknown): ReadonlySet<string> => {
  const optional = new Set<string>();
  if (value === null || typeof value !== 'object') return optional;
  for (const [name, meta] of Object.entries(value)) {
    if (meta !== null && typeof meta === 'object' && (meta as { optional?: unknown }).optional === true) {
      optional.add(name);
    }
  }
  return optional;
};

/** Reads `peerDependencies`/`peerDependenciesMeta` from a cached manifest; unreadable means none. */
const readDeclaredPeers = (installDir: string): DeclaredPeers => {
  try {
    const manifest = JSON.parse(readFileSync(join(installDir, 'package.json'), 'utf8')) as {
      peerDependencies?: unknown;
      peerDependenciesMeta?: unknown;
    };
    return {
      peers: stringEntries(manifest.peerDependencies),
      optional: optionalPeerNames(manifest.peerDependenciesMeta),
    };
  } catch {
    return { peers: {}, optional: new Set() };
  }
};

// peerDependencies comes from a cached manifest — untrusted input. A name must match npm's package
// grammar (scoped or plain, safe characters, no traversal) before it may reach an npm spawn; the
// install itself is additionally confined by `--prefix <npmRoot>`.
const peerSegmentPattern = /^[a-z0-9][a-z0-9._-]*$/i;
const validPeerSegment = (segment: string): boolean => !segment.includes('\\') && peerSegmentPattern.test(segment);
const validPeerName = (name: string): boolean => {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/');
    return slash > 1 && validPeerSegment(name.slice(1, slash)) && validPeerSegment(name.slice(slash + 1));
  }
  return !name.includes('/') && validPeerSegment(name);
};

const peerPresent = (installDir: string, npmRoot: string, name: string): boolean =>
  existsSync(join(installDir, 'node_modules', ...name.split('/'))) ||
  existsSync(join(npmRoot, 'node_modules', ...name.split('/')));

/**
 * Checks each declared non-optional peer for presence and installs the absent ones when online.
 * Returns one warning per unmet peer that could not be satisfied; the extension always stays served.
 */
export const ensurePeerDependencies = async (input: EnsurePeerDependenciesInput): Promise<readonly string[]> => {
  const warnings: string[] = [];
  const { peers, optional } = readDeclaredPeers(input.installDir);
  const peerSpawn = input.peerSpawn ?? defaultPeerSpawner;
  for (const [name, range] of Object.entries(peers)) {
    if (optional.has(name)) continue;
    if (!validPeerName(name)) {
      warnings.push(
        `extension '${input.specifier}' declares an invalid peer dependency name '${name}'; it will not be installed.`,
      );
      continue;
    }
    if (peerPresent(input.installDir, input.npmRoot, name)) continue;
    if (input.offline) {
      warnings.push(
        `extension '${input.specifier}' is missing peer dependency '${name}' and cannot install it offline; ` +
          'fresh loaders may fail to load this extension.',
      );
      continue;
    }
    try {
      const exitCode = await peerSpawn({ name, range, npmRoot: input.npmRoot, debug: input.debug });
      if (exitCode !== 0) {
        warnings.push(
          `extension '${input.specifier}' failed to install peer dependency '${name}' (npm exited ${exitCode}); ` +
            'fresh loaders may fail to load this extension.',
        );
      }
    } catch (error) {
      warnings.push(
        `extension '${input.specifier}' failed to install peer dependency '${name}' (${String(error)}); ` +
          'fresh loaders may fail to load this extension.',
      );
    }
  }
  return warnings;
};
