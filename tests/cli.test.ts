import { describe, expect, it } from 'vitest';

import { createProgram } from '../src/cli.js';

describe('createProgram', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-001.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('constructs the Commander-based Bridl program shell', () => {
    const program = createProgram();

    expect(program.name()).toBe('bridl');
    expect(program.description()).toContain('Profile-oriented wrapper');
  });
});
