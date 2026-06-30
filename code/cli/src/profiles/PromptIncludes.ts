// Resolves typed append-system-prompt file includes against declaring profile source roots.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path';

import type { AgentLaunchProfileLayer } from '../agents/AgentAdapter.js';
import type { AppendSystemPromptControl, AppendSystemPromptEntry } from './Profile.js';
import type { LoadedProfile } from './ProfileLoader.js';

export interface PromptIncludeDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly profileId: string;
  readonly path: string;
  readonly message: string;
}

export interface ResolvedAppendPromptResult {
  readonly prompts: readonly string[];
  readonly diagnostics: readonly PromptIncludeDiagnostic[];
}

export const isPromptFileInclude = (value: unknown): value is { readonly file: string } =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof (value as { readonly file?: unknown }).file === 'string';

export const isPromptRepoFileInclude = (value: unknown): value is { readonly repo_file: string } =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof (value as { readonly repo_file?: unknown }).repo_file === 'string';

export const normalizeAppendSystemPromptEntries = (
  value: AppendSystemPromptControl | undefined,
): readonly AppendSystemPromptEntry[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'string' || isPromptFileInclude(value) || isPromptRepoFileInclude(value) ? [value] : value;
};

export const inferProfileIncludeSourceRoot = (input: {
  readonly sourceRootPath?: string;
  readonly profilePath: string;
}): string | undefined => {
  const conventionalRoot = findConventionalOutfitterRoot(input.profilePath);

  return conventionalRoot ?? input.sourceRootPath;
};

export const resolveAppendSystemPromptControl = (input: {
  readonly fallback: AppendSystemPromptControl | undefined;
  readonly profileLayers?: readonly AgentLaunchProfileLayer[];
  readonly agentKey?: 'pi' | 'claude';
  readonly projectDirectory?: string;
}): ResolvedAppendPromptResult => {
  const layeredEntries = collectLayeredPromptEntries(input.profileLayers ?? [], input.agentKey);

  if (layeredEntries.length === 0) {
    return resolvePromptEntries({
      entries: normalizeAppendSystemPromptEntries(input.fallback) ?? [],
      projectDirectory: input.projectDirectory,
    });
  }

  const diagnostics: PromptIncludeDiagnostic[] = [];
  const prompts: string[] = [];

  for (const entry of layeredEntries) {
    const resolved = resolvePromptEntries({
      entries: [entry.value],
      layer: entry.layer,
      projectDirectory: input.projectDirectory,
    });
    diagnostics.push(...resolved.diagnostics);
    prompts.push(...resolved.prompts);
  }

  return { prompts, diagnostics };
};

export const createPromptIncludeDiagnostics = (
  profileLayers: readonly LoadedProfile[],
  projectDirectory?: string,
): readonly PromptIncludeDiagnostic[] =>
  profileLayers.flatMap((layer) => {
    const launchLayer = toLaunchLayer(layer);
    return [
      ...resolvePromptEntries({
        entries: readPromptEntries(layer.profile.controls.appendSystemPrompt),
        layer: launchLayer,
        projectDirectory,
      }).diagnostics,
      ...resolvePromptEntries({
        entries: readPromptEntries(layer.profile.controls.pi?.appendSystemPrompt),
        layer: launchLayer,
        projectDirectory,
      }).diagnostics,
      ...resolvePromptEntries({
        entries: readPromptEntries(layer.profile.controls.claude?.appendSystemPrompt),
        layer: launchLayer,
        projectDirectory,
      }).diagnostics,
    ];
  });

const collectLayeredPromptEntries = (
  profileLayers: readonly AgentLaunchProfileLayer[],
  agentKey: 'pi' | 'claude' | undefined,
): readonly { readonly layer: AgentLaunchProfileLayer; readonly value: AppendSystemPromptEntry }[] =>
  [...profileLayers]
    .reverse()
    .flatMap((layer) => readPromptEntries(selectLayerAppendPrompt(layer, agentKey)).map((value) => ({ layer, value })));

const selectLayerAppendPrompt = (
  layer: AgentLaunchProfileLayer,
  agentKey: 'pi' | 'claude' | undefined,
): AppendSystemPromptControl | undefined => {
  const agentPrompt = agentKey === undefined ? undefined : layer.profile.controls[agentKey]?.appendSystemPrompt;

  return agentPrompt ?? layer.profile.controls.appendSystemPrompt;
};

const resolvePromptEntries = (input: {
  readonly entries: readonly AppendSystemPromptEntry[];
  readonly layer?: AgentLaunchProfileLayer;
  readonly projectDirectory?: string;
}): ResolvedAppendPromptResult => {
  const diagnostics: PromptIncludeDiagnostic[] = [];
  const prompts: string[] = [];

  for (const [index, entry] of input.entries.entries()) {
    if (isPromptFileInclude(entry) || isPromptRepoFileInclude(entry)) {
      const declaredFile = isPromptFileInclude(entry) ? entry.file : entry.repo_file;
      const resolvedFile = isPromptFileInclude(entry)
        ? resolvePromptIncludePath(input.layer, declaredFile)
        : resolveRepoPromptIncludePath(input.projectDirectory, declaredFile);
      const includeType = isPromptFileInclude(entry) ? 'file' : 'repo_file';

      if (resolvedFile === undefined || !existsSync(resolvedFile)) {
        diagnostics.push(
          createDiagnostic(input.layer, index, `Prompt ${includeType} include '${declaredFile}' was not found.`),
        );
      } else {
        prompts.push(readFileSync(resolvedFile, 'utf8'));
      }
    } else {
      if (looksLikePromptFilePath(entry)) {
        diagnostics.push(
          createDiagnostic(
            input.layer,
            index,
            `Raw append_system_prompt entry looks like a file path; use { file: '${entry}' }.`,
          ),
        );
      }
      prompts.push(entry);
    }
  }

  return { prompts, diagnostics };
};

const readPromptEntries = (value: AppendSystemPromptControl | undefined): readonly AppendSystemPromptEntry[] =>
  normalizeAppendSystemPromptEntries(value) ?? [];

const resolvePromptIncludePath = (layer: AgentLaunchProfileLayer | undefined, filePath: string): string | undefined => {
  if (isAbsolute(filePath)) {
    return normalize(filePath);
  }

  const sourceRoot = layer?.sourceRootPath === undefined ? undefined : inferProfileIncludeSourceRoot(layer);

  return sourceRoot === undefined ? undefined : resolve(sourceRoot, filePath);
};

const resolveRepoPromptIncludePath = (projectDirectory: string | undefined, filePath: string): string | undefined => {
  if (isAbsolute(filePath)) {
    return normalize(filePath);
  }

  return projectDirectory === undefined ? undefined : resolve(projectDirectory, filePath);
};

const createDiagnostic = (
  layer: AgentLaunchProfileLayer | undefined,
  index: number,
  message: string,
): PromptIncludeDiagnostic => ({
  severity: 'warning',
  profileId: layer?.profile.id ?? '<merged>',
  path: `${layer?.profilePath ?? '<profile>'}#/controls/append_system_prompt/${index}`,
  message,
});

export const looksLikePromptFilePath = (value: string): boolean => {
  const trimmed = value.trim();

  if (trimmed.includes('\n') || trimmed.includes(' ')) {
    return false;
  }

  return /^(\.?\.?\/|~\/).+/u.test(trimmed) || /.+\/.+\.(md|markdown|txt|prompt)$/iu.test(trimmed);
};

const findConventionalOutfitterRoot = (profilePath: string): string | undefined => {
  let current = dirname(profilePath);

  while (current !== dirname(current)) {
    const name = basename(current);

    if (name === '.outfitter') {
      return normalize(current) === normalize(join(homedir(), '.outfitter')) ? current : dirname(current);
    }

    if (name === 'outfitter') {
      return dirname(current);
    }

    current = dirname(current);
  }

  return undefined;
};

const toLaunchLayer = (loadedProfile: LoadedProfile): AgentLaunchProfileLayer => ({
  profile: loadedProfile.profile,
  profilePath: loadedProfile.profilePath,
  sourceRootPath: loadedProfile.sourceRootPath,
  resourceRootPath: loadedProfile.resourceRootPath,
  layout: loadedProfile.layout,
});
