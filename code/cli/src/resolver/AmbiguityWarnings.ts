// Reports source-ref and resource-slug disagreements without changing deterministic precedence.
import type { LoadedSettingsFile } from '../settings/SettingsLoader.js';
import type { SourceReference } from '../settings/Settings.js';
import {
  encodeRemoteSourceSelection,
  isRemoteSource,
  normalizeGitUri,
  normalizeRemoteSourceUri,
  redactSourceUriCredentials,
} from '../sources/SourceCache.js';
import type { RemoteSourceReference } from '../sources/SourceCache.js';
import type { DeclaredRemoteSource } from '../sources/TransitiveSources.js';
import type { EffectiveResourceSet, ResolvedResource, ResourceKind } from './Resource.js';

interface SourceDeclaration {
  readonly source: RemoteSourceReference;
  readonly declaredBy: string;
}

export const strictAmbiguityFailureMessage = 'Strict mode: ambiguous resolution is fatal.';

const repositoryKey = (source: RemoteSourceReference): string =>
  redactSourceUriCredentials(normalizeGitUri(normalizeRemoteSourceUri(source)));

const repositoryDisplay = (source: RemoteSourceReference): string => {
  if (source.github !== undefined) return `github:${source.github}`;
  return redactSourceUriCredentials(normalizeGitUri(source.uri));
};

const refDisplay = (source: RemoteSourceReference): string => source.ref ?? '(default)';

const directDeclarations = (files: readonly LoadedSettingsFile[]): readonly SourceDeclaration[] =>
  [...files]
    .reverse()
    .flatMap((file) =>
      (file.settings.sources ?? [])
        .filter(isRemoteSource)
        .map((source) => ({ source, declaredBy: file.location.path })),
    );

const replacedSourceListWarnings = (
  files: readonly LoadedSettingsFile[],
  effectiveSources: readonly SourceReference[],
): readonly string[] => {
  const replacingIndex = files.findLastIndex((file) => file.settings.sources !== undefined);
  if (replacingIndex < 1) return [];

  const replacingFile = files[replacingIndex];
  const effectiveRepositories = new Set(effectiveSources.filter(isRemoteSource).map(repositoryKey));
  const reportedRepositories = new Set<string>();
  const warnings: string[] = [];

  for (const file of files.slice(0, replacingIndex).reverse()) {
    for (const source of (file.settings.sources ?? []).filter(isRemoteSource)) {
      const key = repositoryKey(source);
      if (effectiveRepositories.has(key) || reportedRepositories.has(key)) continue;
      reportedRepositories.add(key);
      warnings.push(
        `source '${repositoryDisplay(source)}' declared by '${file.location.path}' was replaced by '${replacingFile.location.path}' and is not in the effective configuration`,
      );
    }
  }

  return warnings;
};

const selectedDeclarations = (
  effectiveSources: readonly SourceReference[],
  direct: readonly SourceDeclaration[],
  transitive: readonly DeclaredRemoteSource[],
): readonly SourceDeclaration[] => {
  const selectedDirect = effectiveSources.filter(isRemoteSource).map((source) => {
    const selection = encodeRemoteSourceSelection(source);
    // Every effective direct source came from one of the loaded files used to produce settings.
    return direct.find((entry) => encodeRemoteSourceSelection(entry.source) === selection)!;
  });
  return [...selectedDirect, ...transitive];
};

export const sourceRefAmbiguityWarnings = (
  files: readonly LoadedSettingsFile[],
  effectiveSources: readonly SourceReference[],
  transitiveDeclarations: readonly DeclaredRemoteSource[],
): readonly string[] => {
  const direct = directDeclarations(files);
  const declarations: readonly SourceDeclaration[] = [...direct, ...transitiveDeclarations];
  const selected = selectedDeclarations(effectiveSources, direct, transitiveDeclarations);
  const byRepository = new Map<string, SourceDeclaration[]>();

  for (const declaration of declarations) {
    const key = repositoryKey(declaration.source);
    const entries = byRepository.get(key) ?? [];
    entries.push(declaration);
    byRepository.set(key, entries);
  }

  const warnings: string[] = [...replacedSourceListWarnings(files, effectiveSources)];
  for (const entries of byRepository.values()) {
    if (new Set(entries.map((entry) => entry.source.ref)).size < 2) continue;
    const key = repositoryKey(entries[0].source);
    const winner = selected.find((entry) => repositoryKey(entry.source) === key);
    if (winner === undefined) continue;
    const declarationsText = entries
      .map((entry) => `'${entry.declaredBy}' declares ref '${refDisplay(entry.source)}'`)
      .join('; ');
    warnings.push(
      `Ambiguous source repository '${repositoryDisplay(entries[0].source)}': ${declarationsText}; declaration from '${winner.declaredBy}' at ref '${refDisplay(winner.source)}' won.`,
    );
  }

  return warnings;
};

const slugWarning = (kind: ResourceKind, resource: ResolvedResource, context?: string): string | undefined => {
  const definitions = [resource.winner, ...resource.shadowed];
  const labels = [...new Set(definitions.map((definition) => definition.layer.label))];
  if (labels.length < 2) return undefined;
  return `Ambiguous ${kind} slug '${resource.slug}'${context ?? ''} is supplied by ${labels.map((label) => `'${label}'`).join(', ')}; '${resource.winner.layer.label}' won.`;
};

const resourceWarnings = (
  kind: ResourceKind,
  resources: Iterable<ResolvedResource> | undefined,
  context?: string,
): readonly string[] =>
  resources === undefined
    ? []
    : [...resources].flatMap((resource) => {
        const warning = slugWarning(kind, resource, context);
        return warning === undefined ? [] : [warning];
      });

export const slugAmbiguityWarnings = (set: EffectiveResourceSet): readonly string[] => [
  ...resourceWarnings('agent', set.resources.get('agent')?.values()),
  ...resourceWarnings('skill', set.resources.get('skill')?.values()),
  ...[...set.agentResources].flatMap(([agent, kinds]) =>
    resourceWarnings('skill', kinds.get('skill')?.values(), ` for agent '${agent}'`),
  ),
];
