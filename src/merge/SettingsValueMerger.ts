// Provides path-aware object/value merging with explicit array policies.
import type { ArrayMergePolicy } from './ArrayMergePolicy.js';
import { mergeArrayByPolicy } from './ArrayMergePolicy.js';

export type MergePath = readonly string[];
export type ArrayMergePolicyResolver = (path: MergePath) => ArrayMergePolicy<MergeableValue> | undefined;

export interface MergeValueOptions {
  readonly arrayPolicyForPath?: ArrayMergePolicyResolver;
}

export type MergeableValue =
  | string
  | number
  | boolean
  | null
  | readonly MergeableValue[]
  | { readonly [key: string]: MergeableValue | undefined };

export type MergeableObject = Readonly<Record<string, MergeableValue | undefined>>;

export const mergeObjectsWithPolicy = <T extends object>(
  lowerPrecedence: T | undefined,
  higherPrecedence: T,
  options: MergeValueOptions = {},
): T => mergeObjectValue(lowerPrecedence ?? {}, higherPrecedence as MergeableObject, [], options) as T;

const mergeObjectValue = (
  lowerPrecedence: MergeableObject,
  higherPrecedence: MergeableObject,
  path: MergePath,
  options: MergeValueOptions,
): MergeableObject => ({
  ...lowerPrecedence,
  ...Object.fromEntries(
    Object.entries(higherPrecedence)
      .filter((entry): entry is [string, MergeableValue] => entry[1] !== undefined)
      .map(([key, value]) => [
        key,
        key in lowerPrecedence
          ? mergeMemberValue(lowerPrecedence[key], value, [...path, key], options)
          : cloneMergeableValue(value),
      ]),
  ),
});

const mergeMemberValue = (
  lowerPrecedence: MergeableValue | undefined,
  higherPrecedence: MergeableValue,
  path: MergePath,
  options: MergeValueOptions,
): MergeableValue => {
  if (Array.isArray(higherPrecedence)) {
    return mergeArrayByPolicy(
      isMergeableArray(lowerPrecedence) ? lowerPrecedence : undefined,
      higherPrecedence,
      options.arrayPolicyForPath?.(path) ?? 'replace',
    );
  }

  if (isPlainMergeableObject(lowerPrecedence) && isPlainMergeableObject(higherPrecedence)) {
    return mergeObjectValue(lowerPrecedence, higherPrecedence, path, options);
  }

  return cloneMergeableValue(higherPrecedence);
};

const cloneMergeableValue = (value: MergeableValue): MergeableValue => {
  if (isMergeableArray(value)) {
    return value.map(cloneMergeableValue);
  }

  if (isPlainMergeableObject(value)) {
    return mergeObjectValue({}, value, [], {});
  }

  return value;
};

const isPlainMergeableObject = (value: unknown): value is MergeableObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isMergeableArray = (value: unknown): value is readonly MergeableValue[] => Array.isArray(value);
