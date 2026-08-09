// Reads root-owned system extension hooks for post-projection launch-plan mutation. This is a
// launcher-scope mechanism, not a managed configuration scope: Pi never reads these files, so they
// do not change Pi's configuration resolution order. A session can still bypass the launcher with
// `pi --no-extensions`, execute bundled Pi directly, or point OUTFITTER_SYSTEM_DIR at an empty
// directory. The honest guarantee is that collection is on by default and the organization owns
// the file naming the collector, not that a session cannot turn collection off.
//
// Hook documents fail closed because only an operator can create files in the normal root-owned
// locations. A malformed file is therefore an operator error caught on a canary boot; failing open
// would silently run the fleet without collection, which downstream verifiers must classify as
// unattested rather than clean.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { Harness } from '../settings/Settings.js';
import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';

const linuxSystemDirectory = '/etc/outfitter/system.d';
const macosSystemDirectory = '/Library/Application Support/Outfitter/system.d';

export interface SystemExtensionHarnessHook {
  readonly extensions?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface SystemExtensionHook {
  readonly filePath: string;
  readonly name: string;
  readonly harnesses: Partial<Readonly<Record<Harness, SystemExtensionHarnessHook>>>;
}

export interface SystemExtensionHookSource {
  readonly directory: string;
  readonly stamp: string;
}

export interface LoadedSystemExtensionHooks {
  readonly hooks: readonly SystemExtensionHook[];
  readonly source?: SystemExtensionHookSource;
}

interface SystemExtensionHookDocument {
  readonly name: string;
  readonly harnesses: Partial<Readonly<Record<Harness, SystemExtensionHarnessHook>>>;
}

export interface SystemExtensionHookDiscoveryInput {
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

export const resolveSystemExtensionHookSource = (
  input: SystemExtensionHookDiscoveryInput = {},
): SystemExtensionHookSource | undefined => {
  const environment = input.environment ?? process.env;
  const override = environment.OUTFITTER_SYSTEM_DIR;

  if (override !== undefined) return { directory: override, stamp: `env-override:${override}` };

  switch (input.platform ?? process.platform) {
    case 'darwin':
      return { directory: macosSystemDirectory, stamp: macosSystemDirectory };
    case 'linux':
      return { directory: linuxSystemDirectory, stamp: linuxSystemDirectory };
    default:
      return undefined;
  }
};

const formatValidationIssues = (
  filePath: string,
  issues: readonly { readonly path: string; readonly message: string }[],
): string => issues.map((issue) => `${filePath}#${issue.path} ${issue.message}`).join('; ');

const assertExtensionPathsExist = (document: SystemExtensionHookDocument, filePath: string): void => {
  for (const hook of Object.values(document.harnesses)) {
    for (const extensionPath of hook.extensions ?? []) {
      if (!isAbsolute(extensionPath) || statSync(extensionPath, { throwIfNoEntry: false }) === undefined) {
        throw new Error(`Invalid system extension hook '${filePath}': extension path does not exist: ${extensionPath}`);
      }
    }
  }
};

const readSystemExtensionHook = (filePath: string): SystemExtensionHook => {
  let content: string;

  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`System extension hook '${filePath}' is unreadable: ${String(error)}`, { cause: error });
  }

  const parsed = parseYamlDocument(content, filePath);
  if (!parsed.ok) {
    throw new Error(`Invalid system extension hook '${filePath}': ${parsed.issue.message}`);
  }

  const validation = validateSchema('system-extension-hook', parsed.document);
  if (!validation.valid) {
    throw new Error(`Invalid system extension hook: ${formatValidationIssues(filePath, validation.issues)}`);
  }

  const document = parsed.document as SystemExtensionHookDocument;
  assertExtensionPathsExist(document, filePath);
  return { filePath, ...document };
};

const assertNoEnvironmentCollisions = (hooks: readonly SystemExtensionHook[]): void => {
  const owners = new Map<string, string>();

  for (const hook of hooks) {
    for (const harness of ['pi', 'claude', 'codex'] as const) {
      for (const name of Object.keys(hook.harnesses[harness]?.env ?? {})) {
        const key = `${harness}:${name}`;
        const owner = owners.get(key);
        if (owner !== undefined) {
          throw new Error(
            `Invalid system extension hooks: environment '${name}' for '${harness}' is declared by both '${owner}' and '${hook.filePath}'.`,
          );
        }
        owners.set(key, hook.filePath);
      }
    }
  }
};

export const readSystemExtensionHooks = (input: SystemExtensionHookDiscoveryInput = {}): LoadedSystemExtensionHooks => {
  const source = resolveSystemExtensionHookSource(input);
  if (source === undefined) return { hooks: [] };

  const sourceStat = statSync(source.directory, { throwIfNoEntry: false });
  if (sourceStat === undefined) return { hooks: [], source };
  if (!sourceStat.isDirectory()) {
    throw new Error(`System extension hook source '${source.directory}' is not a directory.`);
  }

  const filePaths = readdirSync(source.directory)
    .filter((name) => name.endsWith('.yml'))
    .sort()
    .map((name) => join(source.directory, name));
  const hooks = filePaths.map(readSystemExtensionHook);
  assertNoEnvironmentCollisions(hooks);

  return { hooks, source };
};
