// Writes a deterministic, self-contained `.agents/` tree for one agent's transitive closure.
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { compose } from '../composer/Composer.js';
import { findResource } from '../resolver/Resource.js';
import type { EffectiveResourceSet, ResolvedResource } from '../resolver/Resource.js';

export interface DumpResult {
  readonly writtenPaths: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** Recursively copies a resource directory, skipping symlinks so no path escapes the tree. */
const copyResourceDirectory = (sourceDir: string, targetDir: string, written: string[]): void => {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (lstatSync(sourcePath).isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      copyResourceDirectory(sourcePath, targetPath, written);
    } else if (entry.isFile()) {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
      written.push(targetPath);
    }
  }
};

/** BFS over the selected agent and its subagents to form the transitive agent closure. */
const agentClosure = (set: EffectiveResourceSet, rootSlug: string): readonly ResolvedResource[] => {
  const seen = new Set<string>();
  const ordered: ResolvedResource[] = [];
  const queue = [rootSlug];

  while (queue.length > 0) {
    const slug = queue.shift()!;

    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);

    const agent = findResource(set, 'agent', slug);

    if (agent === undefined) {
      continue;
    }

    ordered.push(agent);
    const composed = compose(set, slug);
    queue.push(...(composed.plan?.loadout.subagents ?? []).map((subagent) => subagent.slug).sort());
  }

  return ordered;
};

const writeRootFile = (set: EffectiveResourceSet, fileName: string, outRoot: string, written: string[]): void => {
  for (const layer of set.layers) {
    const candidate = join(layer.root, fileName);

    if (existsSync(candidate)) {
      const target = join(outRoot, fileName);
      writeFileSync(target, readFileSync(candidate, 'utf8'));
      written.push(target);
      return;
    }
  }
};

/** Writes the composed closure of `agentSlug` into `<outDirectory>/.agents/`. */
export const dumpAgent = (set: EffectiveResourceSet, agentSlug: string, outDirectory: string): DumpResult => {
  const composed = compose(set, agentSlug);

  if (composed.plan === undefined) {
    return { writtenPaths: [], warnings: [], errors: composed.errors };
  }

  const outRoot = join(outDirectory, '.agents');
  mkdirSync(outRoot, { recursive: true });
  const written: string[] = [];

  writeRootFile(set, 'system-prompt.md', outRoot, written);
  writeRootFile(set, 'agents.md', outRoot, written);

  const agents = agentClosure(set, agentSlug);
  const skillSlugs = new Set<string>();

  for (const agent of agents) {
    copyResourceDirectory(dirname(agent.winner.path), join(outRoot, 'agents', agent.slug), written);
    for (const skill of compose(set, agent.slug).plan?.loadout.skills ?? []) {
      skillSlugs.add(skill.slug);
    }
  }

  for (const slug of [...skillSlugs].sort()) {
    const skill = findResource(set, 'skill', slug)!;
    copyResourceDirectory(dirname(skill.winner.path), join(outRoot, 'skills', slug), written);
  }

  return { writtenPaths: written.sort(), warnings: composed.plan.warnings, errors: [] };
};
