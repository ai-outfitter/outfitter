import { describe, expect, it } from 'vitest';

import { composedIdentityBody } from '../../src/projection/Materialize.js';

describe('composed identity body', () => {
  it('accepts an identity with no appended prompts or agent bodies', () => {
    expect(composedIdentityBody({})).toBe('');
  });
});
