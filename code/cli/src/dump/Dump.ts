// Writes a deterministic, self-contained `.agents/` tree for one agent's transitive closure.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import { compose } from '../composer/Composer.js';
import { compareSlugs, findResource } from '../resolver/Resource.js';
import type { EffectiveResourceSet, ResolvedResource } from '../resolver/Resource.js';

export interface DumpResult {
  readonly writtenPaths: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

const loadoutKeys = ['skills', 'subagents', 'mcp', 'extensions', 'plugins', 'model', 'thinking', 'tools'] as const;

/** True when the path is a symlink; a symlinked resource directory cannot be safely dumped. */
const isSymlink = (path: string): boolean => {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
};

/** Recursively copies a resource directory, skipping symlinks so no path escapes the tree. */
const copyResourceDirectory = (
  sourceDir: string,
  targetDir: string,
  written: string[],
  excludeNames: readonly string[] = [],
): void => {
  const entries = readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => compareSlugs(a.name, b.name));

  for (const entry of entries) {
    if (excludeNames.includes(entry.name)) {
      continue;
    }

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

/** Shallow-merges the effective per-agent config.json (loadout keys) across layers, highest wins. */
const mergeEffectiveConfig = (configPaths: readonly string[]): Record<string, unknown> => {
  let merged: Record<string, unknown> = {};

  for (const configPath of [...configPaths].reverse()) {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const loadout = Object.fromEntries(loadoutKeys.filter((key) => key in parsed).map((key) => [key, parsed[key]]));
    merged = { ...merged, ...loadout };
  }

  return merged;
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
    queue.push(...(composed.plan?.loadout.subagents ?? []).map((subagent) => subagent.slug).sort(compareSlugs));
  }

  return ordered;
};

// Only regular files are dumped for identity roots; a symlinked root file is skipped to a lower layer.
const writeRootFile = (set: EffectiveResourceSet, fileName: string, outRoot: string, written: string[]): void => {
  for (const layer of set.layers) {
    const candidate = join(layer.root, fileName);

    if (existsSync(candidate) && !isSymlink(candidate) && lstatSync(candidate).isFile()) {
      const target = join(outRoot, fileName);
      writeFileSync(target, readFileSync(candidate, 'utf8'));
      written.push(target);
      return;
    }
  }
};

interface ClosureCompose {
  readonly agents: readonly ResolvedResource[];
  readonly skillSlugs: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

/** Composes every closure member, collecting skills, warnings, and any composition errors. */
const composeClosure = (set: EffectiveResourceSet, rootSlug: string): ClosureCompose => {
  const agents = agentClosure(set, rootSlug);
  const skillSlugs = new Set<string>();
  const warnings: string[] = [];
  const errors: string[] = [];

  for (const agent of agents) {
    const composed = compose(set, agent.slug);

    if (composed.plan === undefined) {
      errors.push(...composed.errors);
      continue;
    }

    warnings.push(...composed.plan.warnings);
    for (const skill of composed.plan.loadout.skills) {
      skillSlugs.add(skill.slug);
    }
  }

  return { agents, skillSlugs: [...skillSlugs].sort(compareSlugs), warnings, errors };
};

const symlinkResourceError = (resource: ResolvedResource): string =>
  `${resource.kind} '${resource.slug}' is a directory symlink and cannot be safely dumped.`;

const writeMergedConfig = (agent: ResolvedResource, agentTarget: string, written: string[]): void => {
  const mergedConfig = mergeEffectiveConfig(agent.configPaths ?? []);

  if (Object.keys(mergedConfig).length > 0) {
    const configTarget = join(agentTarget, 'config.json');
    mkdirSync(agentTarget, { recursive: true });
    writeFileSync(configTarget, `${JSON.stringify(mergedConfig, null, 2)}\n`);
    written.push(configTarget);
  }
};

/** Writes the composed closure of `agentSlug` into a freshly cleaned `<outDirectory>/.agents/`. */
export const dumpAgent = (set: EffectiveResourceSet, agentSlug: string, outDirectory: string): DumpResult => {
  const rootCompose = compose(set, agentSlug);

  if (rootCompose.plan === undefined) {
    return { writtenPaths: [], warnings: [], errors: rootCompose.errors };
  }

  const closure = composeClosure(set, agentSlug);

  if (closure.errors.length > 0) {
    return { writtenPaths: [], warnings: closure.warnings, errors: closure.errors };
  }

  const resources = [...closure.agents, ...closure.skillSlugs.map((slug) => findResource(set, 'skill', slug)!)];
  const symlinked = resources.filter((resource) => isSymlink(dirname(resource.winner.path)));

  if (symlinked.length > 0) {
    return { writtenPaths: [], warnings: closure.warnings, errors: symlinked.map(symlinkResourceError) };
  }

  const outRoot = join(outDirectory, '.agents');
  rmSync(outRoot, { recursive: true, force: true }); // clean destination so the dump is closure-scoped
  mkdirSync(outRoot, { recursive: true });
  const written: string[] = [];

  writeRootFile(set, 'system-prompt.md', outRoot, written);
  writeRootFile(set, 'agents.md', outRoot, written);

  for (const agent of closure.agents) {
    const agentTarget = join(outRoot, 'agents', agent.slug);
    copyResourceDirectory(dirname(agent.winner.path), agentTarget, written, ['config.json']);
    writeMergedConfig(agent, agentTarget, written);
  }

  for (const slug of closure.skillSlugs) {
    copyResourceDirectory(
      dirname(findResource(set, 'skill', slug)!.winner.path),
      join(outRoot, 'skills', slug),
      written,
    );
  }

  return { writtenPaths: written.sort(compareSlugs), warnings: closure.warnings, errors: [] };
};
