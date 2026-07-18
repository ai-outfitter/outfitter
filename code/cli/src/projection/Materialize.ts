// Materializes a CompositionPlan into a runtime configuration directory the harness launches from.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CompositionPlan } from '../composer/Composition.js';

export interface MaterializedComposition {
  readonly rootDirectory: string;
  /** Absolute path to the composed system prompt written for the run. */
  readonly systemPromptPath: string;
  /** Absolute paths to append-prompt fragments, in composition order. */
  readonly appendPromptPaths: readonly string[];
  /** Absolute paths to materialized skill directories, keyed by slug. */
  readonly skillDirectories: readonly string[];
}

/**
 * Writes the composed identity and skills into `rootDirectory`. The base `system-prompt.md` becomes
 * the system prompt; shared `agents.md` context and the agent body are appended in order.
 */
export const materializeComposition = (
  composition: CompositionPlan,
  rootDirectory: string,
): MaterializedComposition => {
  mkdirSync(rootDirectory, { recursive: true });

  const systemPromptPath = join(rootDirectory, 'system-prompt.md');
  writeFileSync(systemPromptPath, composition.identity.systemPrompt ?? '');

  const appendPromptPaths: string[] = [];

  if (composition.identity.sharedContext !== undefined) {
    const contextPath = join(rootDirectory, 'agents.md');
    writeFileSync(contextPath, composition.identity.sharedContext);
    appendPromptPaths.push(contextPath);
  }

  const agentBodyPath = join(rootDirectory, 'agent.md');
  writeFileSync(agentBodyPath, composition.identity.agentBody);
  appendPromptPaths.push(agentBodyPath);

  const skillDirectories = composition.loadout.skills.map((skill) => {
    const skillDir = join(rootDirectory, 'skills', skill.slug);
    mkdirSync(skillDir, { recursive: true });
    return skillDir;
  });

  return { rootDirectory, systemPromptPath, appendPromptPaths, skillDirectories };
};
