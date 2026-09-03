// Composes settings-layer (`settings.yml:agent_defaults`) entries into an agent's effective loadout.
// Defaults ride the same deterministic parent-first ordering and stable de-duplication as inherited
// agent loadouts, resolving catalog-wide ahead of the whole inheritance chain — like a root-most
// ancestor — while agent-declared entries keep owner-first resolution.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { CompositionAgentDefaults } from './Composition.js';
import type { PromptFragment, PromptSourceReference } from './PromptSource.js';
import { promptSourceKey, resolvePromptSource } from './PromptSource.js';
import type { EffectiveResourceSet, ResolvedResource } from '../resolver/Resource.js';
import { findLoadoutResource, findResource } from '../resolver/Resource.js';
import type { AgentDefaults } from '../settings/Settings.js';
import { isEmptyAgentDefaults } from '../settings/Settings.js';

/** One declared loadout slug and where it was declared; `owner` is unset for settings defaults. */
export interface DeclaredSlug {
  readonly slug: string;
  readonly owner?: string;
}

export interface PromptSelection {
  readonly source: PromptSourceReference;
  readonly owner?: string;
  /** Position within the declaring surface; append selections number fragments for their labels. */
  readonly index: number;
}

/** Provenance label for settings-layer declarations; the colon is unreachable by agent slugs. */
export const SETTINGS_DEFAULTS_DECLARER = 'settings:agent_defaults';

/** Settings-layer selections resolve catalog-wide; chain entries resolve owner-first. */
export const settingsSelections = (slugs: readonly string[] | undefined): readonly DeclaredSlug[] =>
  (slugs ?? []).map((slug) => ({ slug, owner: undefined }));

/** Composes selection groups parent-first, collapsing duplicate slugs to their first occurrence. */
export const mergeSelections = (...groups: readonly (readonly DeclaredSlug[])[]): readonly DeclaredSlug[] => {
  const selections: DeclaredSlug[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const selection of group) {
      if (!seen.has(selection.slug)) {
        seen.add(selection.slug);
        selections.push(selection);
      }
    }
  }
  return selections;
};

export const settingsPromptSelections = (
  sources: readonly PromptSourceReference[] | undefined,
): readonly PromptSelection[] => (sources ?? []).map((source, index) => ({ source, owner: undefined, index }));

/** Composes prompt-selection groups parent-first, collapsing duplicate sources to their first occurrence. */
export const mergePromptSelections = (
  ...groups: readonly (readonly PromptSelection[])[]
): readonly PromptSelection[] => {
  const selections: PromptSelection[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const selection of group) {
      const key = promptSourceKey(selection.source);
      if (!seen.has(key)) {
        seen.add(key);
        selections.push(selection);
      }
    }
  }
  return selections;
};

/** Resolves a selection where it was declared: settings defaults catalog-wide, chain entries owner-first. */
export const resolveSelectionResource = (
  set: EffectiveResourceSet,
  kind: 'skill' | 'agent',
  selection: DeclaredSlug,
): ResolvedResource | undefined =>
  selection.owner === undefined
    ? findResource(set, kind, selection.slug)
    : findLoadoutResource(set, selection.owner, kind, selection.slug);

/** Names the declaring layer of a selection so unresolved references point at the right surface. */
export const selectionReference = (kind: 'skill' | 'agent', selection: DeclaredSlug): string => {
  const noun = kind === 'agent' ? 'subagents' : `${kind}s`;
  return selection.owner === undefined ? `agent_defaults ${noun}` : `loadout ${noun}`;
};

export const resolveDeclaredSlugs = (
  set: EffectiveResourceSet,
  kind: 'skill' | 'agent',
  selections: readonly DeclaredSlug[],
  warnings: string[],
  prefix = '',
): readonly ResolvedResource[] => {
  const resolved: ResolvedResource[] = [];

  for (const selection of selections) {
    const resource = resolveSelectionResource(set, kind, selection);

    if (resource === undefined) {
      warnings.push(`${prefix}${selectionReference(kind, selection)} references unknown ${kind} '${selection.slug}'.`);
    } else {
      resolved.push(resource);
    }
  }

  return resolved;
};

/** Resolves one settings-layer prompt source; catalog `file` sources use the first layer that has the file. */
export const resolveSettingsPromptSelection = (
  set: EffectiveResourceSet,
  selection: PromptSelection,
  projectDirectory: string | undefined,
  label: string,
  warnings: string[],
  errors: string[],
): PromptFragment | undefined => {
  const file = selection.source.file;
  // Highest-precedence layer wins; a file no layer contains falls through to the workspace layer so
  // resolvePromptSource reports the standard missing-file error. Prompt resolution only runs for a
  // resolvable agent, and agents live inside layers, so a layer always exists here.
  const layer =
    file !== undefined
      ? (set.layers.find((candidate) => existsSync(join(candidate.root, file))) ?? set.layers[0])
      : set.layers[0];

  const resolved = resolvePromptSource({
    source: selection.source,
    declaringAgent: SETTINGS_DEFAULTS_DECLARER,
    layer,
    projectDirectory,
    optionalRepoFile: true,
    label,
  });
  if (resolved.warning !== undefined) warnings.push(resolved.warning);
  if (resolved.error !== undefined) errors.push(resolved.error);
  return resolved.fragment;
};

/** The settings-layer defaults a plan records, present only when the layer actually declares some. */
export const planAgentDefaults = (defaults: AgentDefaults | undefined): CompositionAgentDefaults | undefined => {
  if (defaults === undefined || isEmptyAgentDefaults(defaults)) return undefined;
  const nonEmpty = <T>(values: readonly T[] | undefined): readonly T[] | undefined =>
    values !== undefined && values.length > 0 ? values : undefined;
  return {
    extensions: nonEmpty(defaults.extensions),
    skills: nonEmpty(defaults.skills),
    mcp: nonEmpty(defaults.mcp),
    plugins: nonEmpty(defaults.plugins),
    subagents: nonEmpty(defaults.subagents),
    appendSystemPrompt: nonEmpty(defaults.appendSystemPrompt),
  };
};
