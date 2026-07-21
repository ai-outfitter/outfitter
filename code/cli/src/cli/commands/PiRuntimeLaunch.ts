// Attaches the Outfitter runtime pi extension to interactive profile launches. The extension
// restores Outfitter's original "connect a model provider" sign-in prompt: when pi starts with no
// models available it offers to connect one and opens pi's native /login. Non-interactive pi
// launches (--print, --export, --mode json|print|rpc, …) are left untouched so scripted runs never
// prompt, and non-pi harnesses pass through unchanged.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AgentLaunchPlan } from '../../projection/Projection.js';

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--export', '--list-models']);
const nonInteractivePiModes = new Set(['json', 'print', 'rpc']);

const runtimeExtensionAsset = 'pi-extension/src/outfitter-runtime-extension.js';

export const isNonInteractivePiLaunch = (args: readonly string[]): boolean =>
  args.some((arg, index) => {
    if (nonInteractivePiLaunchFlags.has(arg)) return true;
    if (arg === '--mode') return nonInteractivePiModes.has(args[index + 1] ?? '');
    if (arg.startsWith('--mode=')) return nonInteractivePiModes.has(arg.slice('--mode='.length));
    return false;
  });

// Resolves the runtime extension in either the repository layout (code/<asset>) or the packaged npm
// layout (code/cli/code/<asset>), mirroring SetupCommand's asset resolver.
const resolveRuntimeExtensionPath = (): string | undefined => {
  const sourcePath = fileURLToPath(new URL(`../../../../${runtimeExtensionAsset}`, import.meta.url));
  const packagePath = fileURLToPath(new URL(`../../../code/${runtimeExtensionAsset}`, import.meta.url));
  /* v8 ignore else -- packaged layout is exercised by the npm package smoke test. */
  if (existsSync(sourcePath)) return sourcePath;
  /* v8 ignore next 2 -- packaged layout is covered by the package smoke test. */
  if (existsSync(packagePath)) return packagePath;
  return undefined;
};

/**
 * Prepends `--extension <runtime>` to a pi launch so the auto sign-in prompt loads. The extension is
 * a no-op whenever a model is already available, so it is safe to attach to every interactive pi
 * run. Non-pi and non-interactive launches are returned unchanged.
 */
export const attachPiRuntimeExtension = (plan: AgentLaunchPlan): AgentLaunchPlan => {
  if (plan.command !== 'pi' || isNonInteractivePiLaunch(plan.args)) return plan;

  const extensionPath = resolveRuntimeExtensionPath();
  /* v8 ignore next -- defensive: the runtime extension ships with the package, so it resolves in practice. */
  if (extensionPath === undefined) return plan;

  return { ...plan, args: ['--extension', extensionPath, ...plan.args] };
};
