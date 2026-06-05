// Models launch inputs as precedence-bearing resources that can be merged and deduplicated.
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
