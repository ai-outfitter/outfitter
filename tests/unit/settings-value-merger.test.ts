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
});
