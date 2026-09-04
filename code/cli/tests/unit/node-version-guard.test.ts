// Covers the startup Node-version guard (issue #368): old Node must get a one-line upgrade
// message instead of the stack trace pi's dependencies throw when spawned.
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  checkNodeVersion,
  enforceNodeVersion,
  formatNodeVersionError,
  readRequiredNodeRange,
} from '../../src/version/NodeVersionGuard.js';

describe('node version guard', () => {
  it('reads the published engines floor from the package manifest', () => {
    expect(readRequiredNodeRange()).toBe('>=22.19.0');
  });

  it.each([
    ['20.18.1', false],
    ['21.7.3', false],
    ['22.9.0', false],
    ['22.18.9', false],
    ['22.19.0', true],
    ['22.20.0', true],
    ['23.11.1', true],
    ['24.18.0', true],
    ['v24.18.0', true],
    ['22', false],
    ['23', true],
    ['22.19', true],
  ])('compares %s against >=22.19.0 as satisfied=%s', (current, satisfied) => {
    expect(checkNodeVersion(current, '>=22.19.0').satisfied).toBe(satisfied);
  });

  it('treats a range it cannot parse as satisfied rather than blocking startup', () => {
    expect(checkNodeVersion('18.0.0', '^22').satisfied).toBe(true);
    expect(checkNodeVersion('18.0.0', '').satisfied).toBe(true);
  });

  it('formats a one-line requirement with the found version and an upgrade hint', () => {
    const message = formatNodeVersionError(checkNodeVersion('21.7.3', '>=22.19.0'));
    expect(message).toContain('requires Node >=22.19.0');
    expect(message).toContain('found v21.7.3');
    expect(message).toContain('Upgrade Node');
  });

  it('writes the message and reports failure on old Node', () => {
    const written: string[] = [];
    expect(enforceNodeVersion('21.7.3', '>=22.19.0', (message) => written.push(message))).toBe(false);
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('found v21.7.3');
  });

  it('stays silent and reports success on supported Node', () => {
    const written: string[] = [];
    expect(enforceNodeVersion('24.18.0', '>=22.19.0', (message) => written.push(message))).toBe(true);
    expect(written).toHaveLength(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the running process and the manifest floor', () => {
    expect(enforceNodeVersion()).toBe(true);
  });

  it('defaults to console.error for the upgrade message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(enforceNodeVersion('21.7.3')).toBe(false);
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0]?.[0]).toContain('found v21.7.3');
  });
});
