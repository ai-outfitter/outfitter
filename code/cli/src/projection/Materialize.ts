// Materializes a CompositionPlan into a runtime configuration directory the harness launches from.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CompositionPlan } from '../composer/Composition.js';
import type { ResolvedResource } from '../resolver/Resource.js';
import { escapesRoots } from '../dump/Containment.js';

export interface MaterializedComposition {
  readonly rootDirectory: string;
  /** Absolute path to the composed system prompt written for the run. */
  readonly systemPromptPath: string;
  /** Absolute paths to append-prompt fragments, in composition order. */
  readonly appendPromptPaths: readonly string[];
  /** Absolute paths to materialized skill directories, in slug order. */
  readonly skillDirectories: readonly string[];
  /** Skills that could not be materialized safely (escaping symlinks). */
  readonly skippedSkills: readonly string[];
}

/** Recursively copies a directory, skipping symlinked entries so no path escapes the tree. */
const copyDirectory = (sourceDir: string, targetDir: string): void => {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);

    if (lstatSync(sourcePath).isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, join(targetDir, entry.name));
    } else if (entry.isFile()) {
      copyFileSync(sourcePath, join(targetDir, entry.name));
    }
  }
};

const materializeSkill = (skill: ResolvedResource, rootDirectory: string): string | undefined => {
  const sourceDir = dirname(skill.winner.path);

  // A skill whose directory resolves outside its layer cannot be materialized safely.
  if (escapesRoots(sourceDir, [skill.winner.layer.root])) {
    return undefined;
  }

  const targetDir = join(rootDirectory, 'skills', skill.slug);
  copyDirectory(sourceDir, targetDir);
  return targetDir;
};

/**
 * Writes the composed identity and skills into `rootDirectory`. The base `system-prompt.md` becomes
 * the system prompt; shared `agents.md` context and the agent body are appended in order. Each
 * selected skill directory (SKILL.md + scripts/assets) is copied so the harness has real content.
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

  const skillDirectories: string[] = [];
  const skippedSkills: string[] = [];

  for (const skill of composition.loadout.skills) {
    const materialized = materializeSkill(skill, rootDirectory);
    if (materialized === undefined) {
      skippedSkills.push(skill.slug);
    } else {
      skillDirectories.push(materialized);
    }
  }

  return { rootDirectory, systemPromptPath, appendPromptPaths, skillDirectories, skippedSkills };
};
