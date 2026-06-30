// Tests generic path-aware settings value merging.
import { describe, expect, it } from 'vitest';

import { mergeObjectsWithPolicy } from '../../src/merge/SettingsValueMerger.js';

describe('settings value merger', () => {
  it('deep-merges objects and replaces arrays by default', () => {
    expect(
      mergeObjectsWithPolicy(
        { nested: { keep: true, list: ['lower'] }, scalarToArray: 'lower' },
        { nested: { list: ['higher'] }, scalarToArray: ['higher'] },
      ),
    ).toEqual({ nested: { keep: true, list: ['higher'] }, scalarToArray: ['higher'] });
  });

  it('coerces scalars to arrays for list append and prepend policies', () => {
    const arrayPolicyForPath = (path: readonly string[]) => {
      if (path.join('.') === 'appendPrompts') return 'appendList' as const;
      if (path.join('.') === 'prependPrompts') return 'prependList' as const;
      return undefined;
    };

    expect(
      mergeObjectsWithPolicy(
        { appendPrompts: ['base'], prependPrompts: 'base' },
        { appendPrompts: 'selected', prependPrompts: ['selected'] },
        { arrayPolicyForPath },
      ),
    ).toEqual({
      appendPrompts: ['base', 'selected'],
      prependPrompts: ['selected', 'base'],
    });
  });

  it('coerces undefined lower-precedence list values to empty arrays for list policies', () => {
    expect(
      mergeObjectsWithPolicy(
        { appendPrompts: undefined },
        { appendPrompts: 'selected' },
        { arrayPolicyForPath: () => 'appendList' },
      ),
    ).toEqual({ appendPrompts: ['selected'] });
  });
});
