// Sync prepares immutable launch trees; run only copies them for harness-owned mutable state.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import type { AgentProjectionPlan } from '../projection/Projection.js';
import { relocateCompiledProjection } from './CompiledProjections.js';
import type { CompiledProfile } from './CompiledRegistry.js';

type LaunchHarness = 'pi' | 'claude';

export const copyCompiledLaunch = (
  profile: CompiledProfile,
  harness: LaunchHarness,
  rootDirectory: string,
): AgentProjectionPlan => {
  const template = profile.projections?.[harness]?.isolated;
  if (template === undefined || !existsSync(join(template.rootDirectory, '.outfitter-projection.json')))
    throw new Error("Compiled launch is unavailable. Run 'outfitter sync --local' first.");
  cpSync(template.rootDirectory, rootDirectory, { recursive: true });
  rmSync(join(rootDirectory, '.outfitter-projection.json'));
  return {
    ...relocateCompiledProjection(template, rootDirectory),
    warnings: template.warnings.filter((warning) => !template.modelWarnings.includes(warning)),
  };
};
