// Tests reusable array merge policy helpers.
import { describe, expect, it } from 'vitest';

import { mergeArrayByPolicy } from '../../src/merge/ArrayMergePolicy.js';

describe('array merge policies', () => {
  it('supports explicit replace, append, prepend, and unique merge semantics', () => {
    expect(mergeArrayByPolicy(['a'], ['b'], 'replace')).toEqual(['b']);
    expect(mergeArrayByPolicy(['a'], ['b'], 'append')).toEqual(['a', 'b']);
    expect(mergeArrayByPolicy(['a'], ['b'], 'prepend')).toEqual(['b', 'a']);
    expect(mergeArrayByPolicy(['a', 'b'], ['b', 'c'], 'appendUnique')).toEqual(['a', 'b', 'c']);
    expect(mergeArrayByPolicy(['a', 'b'], ['b', 'c'], 'prependUnique')).toEqual(['b', 'c', 'a']);
  });

  it('can deduplicate by semantic key while preserving the winning source string', () => {
    const lower = ['npm:tool@1', 'git:github.com/acme/one#main'];
    const higher = ['npm:tool@2', 'git+https://github.com/acme/two.git#v1'];

    expect(
      mergeArrayByPolicy(lower, higher, {
        mode: 'uniqueBy',
        order: 'prepend',
        winner: 'first',
        key: (value) => value.replace(/@\d$/u, ''),
      }),
    ).toEqual(['npm:tool@2', 'git+https://github.com/acme/two.git#v1', 'git:github.com/acme/one#main']);
    expect(
      mergeArrayByPolicy(lower, higher, {
        mode: 'uniqueBy',
        order: 'append',
        winner: 'last',
        key: (value) => value.replace(/@\d$/u, ''),
      }),
    ).toEqual(['git:github.com/acme/one#main', 'npm:tool@2', 'git+https://github.com/acme/two.git#v1']);
  });

  it('deduplicates non-string values with stable default keys', () => {
    expect(mergeArrayByPolicy([1, null, { b: 2, a: 1 }], [1, { a: 1, b: 2 }, false], 'appendUnique')).toEqual([
      1,
      null,
      { b: 2, a: 1 },
      false,
    ]);
  });
});
