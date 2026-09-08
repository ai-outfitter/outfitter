// Freezes referenced resource trees by content, without retaining links to mutable catalog files.
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { CompositionPlan } from '../composer/Composition.js';
import { escapesRoots } from '../dump/Containment.js';
import type { ResolvedResource, ResourceDefinition } from '../resolver/Resource.js';
import { compareSlugs } from '../resolver/Resource.js';

export const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => compareSlugs(left, right)))
      : item,
  );

export const contentDigest = (value: string): string => createHash('sha256').update(value).digest('hex');

interface AssetFile {
  readonly path: string;
  readonly content: string;
  readonly executable: boolean;
}

interface AssetTree {
  readonly directory: string;
  readonly files: readonly AssetFile[];
}

const readTree = (source: string, relativePath = ''): readonly AssetFile[] => {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) return [];
  if (stat.isDirectory())
    return readdirSync(source)
      .sort(compareSlugs)
      .flatMap((name) => readTree(join(source, name), join(relativePath, name)));
  if (!stat.isFile()) throw new Error(`Cannot compile non-file asset '${source}'.`);
  return [
    { path: relativePath, content: readFileSync(source).toString('base64'), executable: (stat.mode & 0o111) !== 0 },
  ];
};

/** Reads first, writes only after every selected profile has composed successfully. */
export class CompiledAssets {
  private readonly trees = new Map<string, AssetTree>();
  private readonly paths = new Map<string, string>();

  constructor(
    private readonly directory: string,
    private readonly roots: readonly string[],
  ) {}

  private snapshot(source: string, directory: boolean): string {
    const cached = this.paths.get(source);
    if (cached !== undefined) return cached;
    if (escapesRoots(source, this.roots)) throw new Error(`Cannot compile asset outside its layer: '${source}'.`);
    if (lstatSync(source).isSymbolicLink()) throw new Error(`Cannot compile a symlinked asset: '${source}'.`);
    const files = directory ? readTree(source) : readTree(source, basename(source));
    const target = join(this.directory, contentDigest(stableJson(files)));
    this.trees.set(target, { directory: target, files });
    const result = directory ? target : join(target, basename(source));
    this.paths.set(source, result);
    return result;
  }

  private definition(definition: ResourceDefinition): ResourceDefinition {
    const directory = this.snapshot(dirname(definition.path), true);
    return {
      ...definition,
      path: join(directory, basename(definition.path)),
      layer: { ...definition.layer, root: directory },
    };
  }

  private resource(resource: ResolvedResource): ResolvedResource {
    const configPaths = resource.configPaths?.map((path) => this.snapshot(path, false));
    return {
      ...resource,
      winner: this.definition(resource.winner),
      shadowed: resource.shadowed.map((definition) => this.definition(definition)),
      ...(configPaths === undefined ? {} : { configPaths, configLayerRoots: configPaths.map(dirname) }),
      ...(resource.mcpPaths === undefined
        ? {}
        : { mcpPaths: resource.mcpPaths.map((path) => this.snapshot(path, false)) }),
      ...(resource.hookPaths === undefined
        ? {}
        : { hookPaths: resource.hookPaths.map((path) => this.snapshot(path, true)) }),
      ...(resource.piConfigDirectories === undefined
        ? {}
        : { piConfigDirectories: resource.piConfigDirectories.map((path) => this.snapshot(path, true)) }),
    };
  }

  freeze(plan: CompositionPlan): CompositionPlan {
    const visit = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(visit);
      if (value === null || typeof value !== 'object') return value;
      if ('winner' in value && 'shadowed' in value) return this.resource(value as ResolvedResource);
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    };
    return visit(plan) as CompositionPlan;
  }

  persist(): void {
    for (const tree of this.trees.values()) {
      if (existsSync(tree.directory)) continue;
      const pending = `${tree.directory}.${randomUUID()}.pending`;
      mkdirSync(pending, { recursive: true, mode: 0o700 });
      try {
        for (const file of tree.files) {
          const path = join(pending, file.path);
          mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
          writeFileSync(path, Buffer.from(file.content, 'base64'), {
            flag: 'wx',
            mode: file.executable ? 0o700 : 0o600,
          });
        }
        renameSync(pending, tree.directory);
      } finally {
        rmSync(pending, { recursive: true, force: true });
      }
    }
  }
}
