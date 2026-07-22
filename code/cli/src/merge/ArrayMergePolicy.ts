// Defines reusable array merge policies for deterministic settings/profile composition.
export type ArrayMergeKey<T> = (item: T) => string;

export type StringArrayMergePolicy =
  'replace' | 'append' | 'prepend' | 'appendUnique' | 'prependUnique' | 'appendList' | 'prependList';

export type ArrayMergePolicy<T = unknown> =
  | StringArrayMergePolicy
  | {
      readonly mode: 'uniqueBy';
      readonly key: ArrayMergeKey<T>;
      readonly order: 'append' | 'prepend';
      readonly winner: 'first' | 'last';
    };

export const mergeArrayByPolicy = <T>(
  lowerPrecedence: readonly T[] | undefined,
  higherPrecedence: readonly T[],
  policy: ArrayMergePolicy<T> = 'replace',
): readonly T[] => {
  const lower = lowerPrecedence ?? [];

  if (typeof policy === 'string') {
    return mergeArrayByStringPolicy(lower, higherPrecedence, policy);
  }

  const ordered = policy.order === 'append' ? [...lower, ...higherPrecedence] : [...higherPrecedence, ...lower];

  return uniqueBy(ordered, policy.key, policy.winner);
};

const mergeArrayByStringPolicy = <T>(
  lower: readonly T[],
  higher: readonly T[],
  policy: StringArrayMergePolicy,
): readonly T[] => {
  if (policy === 'replace') {
    return [...higher];
  }

  if (policy === 'append' || policy === 'appendList') {
    return [...lower, ...higher];
  }

  if (policy === 'prepend' || policy === 'prependList') {
    return [...higher, ...lower];
  }

  if (policy === 'appendUnique') {
    return uniqueBy([...lower, ...higher], defaultArrayMergeKey, 'first');
  }

  return uniqueBy([...higher, ...lower], defaultArrayMergeKey, 'first');
};

const uniqueBy = <T>(items: readonly T[], key: ArrayMergeKey<T>, winner: 'first' | 'last'): readonly T[] => {
  if (winner === 'first') {
    const seen = new Set<string>();
    const result: T[] = [];

    for (const item of items) {
      const itemKey = key(item);

      if (!seen.has(itemKey)) {
        seen.add(itemKey);
        result.push(item);
      }
    }

    return result;
  }

  return [...uniqueBy([...items].reverse(), key, 'first')].reverse();
};

const defaultArrayMergeKey = <T>(item: T): string => {
  if (typeof item === 'string') {
    return item;
  }

  if (item === null || typeof item !== 'object') {
    return JSON.stringify(item);
  }

  return JSON.stringify(item, Object.keys(item).sort());
};
