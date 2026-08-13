// Attaches the Outfitter runtime pi extension to interactive profile launches. The extension owns
// the Outfitter + pi header, active-profile status, and "connect a model provider" sign-in prompt.
// Non-interactive pi launches (--print, --export, --mode json|print|rpc, …) are left untouched so
// scripted runs never prompt, and non-pi harnesses pass through unchanged.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findRepositoryCodeAsset } from '../../paths/RepositoryAssets.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--export', '--list-models']);
const nonInteractivePiModes = new Set(['json', 'print', 'rpc']);

const runtimeExtensionAsset = 'pi-extension/src/outfitter-runtime-extension.js';

export interface PiRuntimeProfileIdentity {
  readonly id: string;
  readonly label?: string;
}

export interface PiRuntimeExtensionInput {
  readonly profile?: PiRuntimeProfileIdentity;
  readonly rootDirectory: string;
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

  return readFileSync(extensionPath, 'utf8').replace(
    /["']__OUTFITTER_ACTIVE_PROFILE__["']/gu,
    JSON.stringify(input.profile) ?? 'undefined',
  );
};

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
