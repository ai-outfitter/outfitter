// Attaches the Outfitter runtime pi extension to interactive profile launches. The extension owns
// the Outfitter + pi header, active-profile status, and "connect a model provider" sign-in prompt.
// Non-interactive pi launches (--print, --export, --mode json|print|rpc, …) are left untouched so
// scripted runs never prompt, and non-pi harnesses pass through unchanged.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRepositoryCodeAsset } from '../../paths/RepositoryAssets.js';
import { resolveHarnessHome } from '../../links/HarnessHome.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--export', '--list-models']);
const nonInteractivePiModes = new Set(['json', 'print', 'rpc']);

const runtimeExtensionAsset = 'pi-extension/src/outfitter-runtime-extension.js';

export interface PiRuntimeProfileIdentity {
  readonly id: string;
  readonly label?: string;
}

export type PiProviderPromptMode = 'dialog' | 'hint';

export interface PiRuntimeExtensionInput {
  readonly profile?: PiRuntimeProfileIdentity;
  readonly rootDirectory: string;
  /**
   * How the extension reacts when pi has no model provider: offer /login in a dialog (default), or
   * print only a one-line /login hint because the user just skipped that step in first-run setup.
   */
  readonly providerPrompt?: PiProviderPromptMode;
  /**
   * Absolute path of the compiled profile registry (`outfitter sync` output) the runtime extension
   * reads for in-session `/outfitter profile` switching. Computed from the durable Pi agent home.
   */
  readonly profilesRegistryPath?: string;
}

export const isNonInteractivePiLaunch = (args: readonly string[]): boolean =>
  args.some((arg, index) => {
    if (nonInteractivePiLaunchFlags.has(arg)) return true;
    if (arg === '--mode') return nonInteractivePiModes.has(args[index + 1] ?? '');
    if (arg.startsWith('--mode=')) return nonInteractivePiModes.has(arg.slice('--mode='.length));
    return false;
  });

/** Stamps per-run identity metadata into the runtime extension source. */
export const createPiRuntimeExtensionContent = (input: Omit<PiRuntimeExtensionInput, 'rootDirectory'>): string => {
  const extensionPath = findRepositoryCodeAsset(runtimeExtensionAsset);
  /* v8 ignore next -- defensive: the runtime extension ships with the package, so it resolves in practice. */
  if (extensionPath === undefined) throw new Error('Outfitter runtime extension was not found.');

  const values: Record<string, unknown> = {
    OUTFITTER_ACTIVE_PROFILE: input.profile,
    OUTFITTER_PROVIDER_PROMPT_MODE: input.providerPrompt ?? 'dialog',
    OUTFITTER_PROFILES_REGISTRY: input.profilesRegistryPath,
  };
  // Each placeholder becomes its JSON value (an absent profile stamps `undefined`). Stamped values
  // are never rescanned, so placeholder-shaped profile metadata is left alone.
  let content = readFileSync(extensionPath, 'utf8');
  for (const [name, value] of Object.entries(values)) {
    content = content.replace(new RegExp(`["']__${name}__["']`, 'gu'), () => JSON.stringify(value) ?? 'undefined');
  }
  return content;
};

/**
 * Resolves the durable compiled-profile registry path for in-session profile switching. The
 * environment is read because a user-managed `PI_CODING_AGENT_DIR` relocates the Pi agent home;
 * the per-run composite directory is never consulted, so switches read the same compiled registry
 * `outfitter sync` wrote.
 */
export const resolveProfilesRegistryPath = (
  homeDirectory: string,
  env: Readonly<Record<string, string | undefined>>,
): string => join(resolveHarnessHome('pi', homeDirectory, env), 'outfitter', 'profiles', 'registry.json');

/**
 * Materializes and prepends `--extension <runtime>` to an interactive pi launch. Non-pi and
 * non-interactive launches are returned unchanged.
 */
export const attachPiRuntimeExtension = (plan: AgentLaunchPlan, input: PiRuntimeExtensionInput): AgentLaunchPlan => {
  if (plan.command !== 'pi' || isNonInteractivePiLaunch(plan.args)) return plan;

  const extensionDirectory = join(input.rootDirectory, '.outfitter');
  const extensionPath = join(extensionDirectory, 'outfitter-runtime-extension.js');
  mkdirSync(extensionDirectory, { recursive: true });
  writeFileSync(extensionPath, createPiRuntimeExtensionContent(input));

  return { ...plan, args: ['--extension', extensionPath, ...plan.args] };
};
