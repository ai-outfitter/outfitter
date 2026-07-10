// Models launch inputs as precedence-bearing resources that can be merged and deduplicated.
import type { SkillControlEntry } from '../profiles/Profile.js';
import { isValidSkillId } from '../skills/SkillDocument.js';
import { normalizeExtensionResourceIdentity, normalizeLaunchResourceIdentity } from './ResourceIdentity.js';

export type LaunchResourceKind = 'extension' | 'skill';
export type LaunchResourceOrigin = 'generic-controls' | 'agent-controls' | 'profile-controls' | 'settings';

export interface LaunchResourceEntry {
  readonly kind: LaunchResourceKind;
  readonly source: string;
  readonly identity: string;
  readonly origin: LaunchResourceOrigin;
  /** Higher values win ties for the same identity. */
  readonly precedence: number;
}

export const createLaunchResourceEntries = (
  kind: LaunchResourceKind,
  sources: readonly string[] = [],
  origin: LaunchResourceOrigin,
  precedence: number,
): readonly LaunchResourceEntry[] =>
  sources.map((source) => ({
    kind,
    source,
    identity: createLaunchResourceIdentity(kind, source),
    origin,
    precedence,
  }));

export const mergeLaunchResourceEntries = (entries: readonly LaunchResourceEntry[]): readonly LaunchResourceEntry[] => {
  const entriesByIdentity = new Map<string, LaunchResourceEntry>();

  for (const entry of entries) {
    const existing = entriesByIdentity.get(entry.identity);

    if (existing === undefined || entry.precedence > existing.precedence) {
      entriesByIdentity.set(entry.identity, entry);
    }
  }

  return entries.filter((entry) => entriesByIdentity.get(entry.identity) === entry);
};

export const mergeLaunchResourceSources = (
  kind: LaunchResourceKind,
  lowerPrecedence: readonly string[] | undefined,
  higherPrecedence: readonly string[] | undefined,
): readonly string[] | undefined => {
  if (lowerPrecedence === undefined && higherPrecedence === undefined) {
    return undefined;
  }

  return mergeLaunchResourceEntries([
    ...createLaunchResourceEntries(kind, higherPrecedence, 'agent-controls', 1),
    ...createLaunchResourceEntries(kind, lowerPrecedence, 'generic-controls', 0),
  ]).map((entry) => entry.source);
};

const createLaunchResourceIdentity = (kind: LaunchResourceKind, source: string): string => {
  if (kind === 'extension') {
    return normalizeExtensionResourceIdentity(source);
  }

  return normalizeLaunchResourceIdentity(source);
};

/** Identity for `controls.skills` entries: bare IDs and `{ id }` objects dedupe together. */
export const skillControlEntryIdentity = (entry: unknown): string => {
  if (typeof entry === 'string') {
    const trimmed = entry.trim();
    return isValidSkillId(trimmed) ? `id:${trimmed}` : normalizeLaunchResourceIdentity(trimmed);
  }

  if (entry !== null && typeof entry === 'object' && typeof (entry as { readonly id?: unknown }).id === 'string') {
    return `id:${(entry as { readonly id: string }).id}`;
  }

  /* v8 ignore next -- schema validation rejects other entry shapes before merging. */
  return normalizeLaunchResourceIdentity(String(entry));
};

export const mergeSkillControlSources = (
  lowerPrecedence: readonly SkillControlEntry[] | undefined,
  higherPrecedence: readonly SkillControlEntry[] | undefined,
): readonly SkillControlEntry[] | undefined => {
  if (lowerPrecedence === undefined && higherPrecedence === undefined) {
    return undefined;
  }

  const merged = [...(higherPrecedence ?? []), ...(lowerPrecedence ?? [])];
  const winners = new Map<string, SkillControlEntry>();

  for (const entry of merged) {
    const identity = skillControlEntryIdentity(entry);

    if (!winners.has(identity)) {
      winners.set(identity, entry);
    }
  }

  return merged.filter((entry) => winners.get(skillControlEntryIdentity(entry)) === entry);
};
