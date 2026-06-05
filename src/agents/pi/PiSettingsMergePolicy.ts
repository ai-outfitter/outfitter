// Defines Pi settings array merge policies and package/extension reconciliation helpers.
import type { ArrayMergePolicy } from '../../merge/ArrayMergePolicy.js';
import { normalizeExtensionResourceIdentity, normalizeLaunchResourceIdentity } from '../ResourceIdentity.js';

export type PiSettingsArrayName = 'packages' | 'extensions' | 'skills' | 'prompts' | 'themes';

export const piSettingsArrayPolicies = {
  packages: {
    mode: 'uniqueBy',
    order: 'append',
    winner: 'last',
    key: (entry: unknown) =>
      normalizePiSettingsPackageResourceIdentity(entry) ?? createUnknownPiSettingsArrayKey(entry),
  },
  extensions: createStringResourceArrayPolicy(normalizeExtensionResourceIdentity),
  skills: createStringResourceArrayPolicy(normalizeLaunchResourceIdentity),
  prompts: createStringResourceArrayPolicy(normalizeLaunchResourceIdentity),
  themes: createStringResourceArrayPolicy(normalizeLaunchResourceIdentity),
} as const satisfies Readonly<Record<PiSettingsArrayName, ArrayMergePolicy<unknown>>>;

export const filterPiSettingsPackagesDuplicatingExtensions = (
  packages: readonly unknown[],
  extensionSources: readonly string[],
): readonly unknown[] => {
  const extensionIdentities = new Set(extensionSources.map(normalizeExtensionResourceIdentity));

  if (extensionIdentities.size === 0) {
    return packages;
  }

  return packages.filter((entry) => {
    const identity = normalizePiSettingsPackageResourceIdentity(entry);
    return identity === undefined || !extensionIdentities.has(identity);
  });
};

export const normalizePiSettingsPackageResourceIdentity = (entry: unknown): string | undefined => {
  const source = readPiSettingsPackageSource(entry);
  return source === undefined ? undefined : normalizeExtensionResourceIdentity(source);
};

export const readPiSettingsPackageSource = (entry: unknown): string | undefined => {
  if (typeof entry === 'string') {
    return entry;
  }

  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    return undefined;
  }

  const record = entry as Readonly<Record<string, unknown>>;
  return typeof record.source === 'string' ? record.source : undefined;
};

function createStringResourceArrayPolicy(normalize: (source: string) => string): ArrayMergePolicy<unknown> {
  return {
    mode: 'uniqueBy',
    order: 'append',
    winner: 'last',
    key: (entry) => (typeof entry === 'string' ? normalize(entry) : createUnknownPiSettingsArrayKey(entry)),
  };
}

const createUnknownPiSettingsArrayKey = (entry: unknown): string => `literal:${stableStringify(entry)}`;

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
};
