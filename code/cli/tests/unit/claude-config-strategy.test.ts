// Tests the inherit/isolated decision for Claude runs: precedence, and the flag probe that forces
// an isolated fallback rather than a failed launch on a Claude too old to load a plugin directory.
import { describe, expect, it } from 'vitest';

import { decideClaudeConfigStrategy, resolveIsolation } from '../../src/agents/ClaudeConfigStrategy.js';
import type { Isolation } from '../../src/settings/Settings.js';

const helpWithInheritFlags = '--plugin-dir <path>\n--mcp-config <configs...>\n--settings <file-or-json>';

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.1).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('claude isolation precedence', () => {
  const cases: readonly { settings: Isolation | undefined; requestedIsolated: boolean; expected: Isolation }[] = [
    { settings: undefined, requestedIsolated: false, expected: 'inherit' },
    { settings: undefined, requestedIsolated: true, expected: 'isolated' },
    { settings: 'inherit', requestedIsolated: false, expected: 'inherit' },
    { settings: 'inherit', requestedIsolated: true, expected: 'isolated' },
    { settings: 'isolated', requestedIsolated: false, expected: 'isolated' },
    { settings: 'isolated', requestedIsolated: true, expected: 'isolated' },
  ];

  for (const { settings, requestedIsolated, expected } of cases) {
    it(`resolves ${String(settings)} settings with --isolated=${String(requestedIsolated)} to ${expected}`, () => {
      expect(resolveIsolation(settings, requestedIsolated)).toBe(expected);
    });
  }
});

describe('claude configuration strategy', () => {
  it('inherits when the installed Claude supports the flags inheriting depends on', () => {
    expect(decideClaudeConfigStrategy('inherit', () => helpWithInheritFlags)).toEqual({ isolation: 'inherit' });
  });

  it('never probes the harness for a run that already asked to be isolated', () => {
    const decision = decideClaudeConfigStrategy('isolated', () => {
      throw new Error('the probe must not run');
    });

    expect(decision).toEqual({ isolation: 'isolated' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.22).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to an isolated run and names the missing flag on a Claude that cannot inherit', () => {
    const decision = decideClaudeConfigStrategy('inherit', () => '--mcp-config <configs...>');

    expect(decision.isolation).toBe('isolated');
    expect(decision.warning).toContain('--plugin-dir');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.22).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to an isolated run when the harness help cannot be read at all', () => {
    const decision = decideClaudeConfigStrategy('inherit', () => undefined);

    expect(decision.isolation).toBe('isolated');
    expect(decision.warning).toContain('isolated run');
  });
});
