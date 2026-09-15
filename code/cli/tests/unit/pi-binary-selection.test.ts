// Tests pi binary selection resolution: env override, settings modes, precedence, and the
// missing-explicit-binary failure policy that keeps a broken pin from silently launching bundled.
import { describe, expect, it } from 'vitest';

import { resolvePiBinarySelection } from '../../src/agents/PiBinarySelection.js';
import type { Settings } from '../../src/settings/Settings.js';

const settings = (overrides: Partial<Settings>): Settings => ({ ...overrides });
const env = (values: Record<string, string | undefined>): Readonly<Record<string, string | undefined>> => values;

describe('pi binary selection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.12.1, OFTR-006.3.31).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('defaults to the bundled binary when no key and no environment override are present', () => {
    const resolution = resolvePiBinarySelection(settings({}), env({}));

    expect(resolution.selection).toEqual({ mode: 'bundled' });
    expect(resolution.warnings).toEqual([]);
    expect(resolution.error).toBeUndefined();
  });

  it('prefers the OUTFITTER_PI_BIN environment variable over the settings selection', () => {
    const resolution = resolvePiBinarySelection(
      settings({ piBinary: 'bundled', piBinaryPath: '/opt/pi' }),
      env({ OUTFITTER_PI_BIN: '/usr/local/bin/pi' }),
    );

    expect(resolution.selection).toEqual({ mode: 'path', binaryPath: '/usr/local/bin/pi' });
    expect(resolution.warnings).toEqual([]);
  });

  it('treats an empty or whitespace-only OUTFITTER_PI_BIN as unset', () => {
    for (const value of [undefined, '', '   ']) {
      const resolution = resolvePiBinarySelection(settings({ piBinary: 'path' }), env({ OUTFITTER_PI_BIN: value }));

      expect(resolution.selection).toEqual({ mode: 'path' });
    }
  });

  it('launches the configured pi_binary_path in path mode', () => {
    const resolution = resolvePiBinarySelection(
      settings({ piBinary: 'path', piBinaryPath: '/opt/pi/bin/pi' }),
      env({}),
    );

    expect(resolution.selection).toEqual({ mode: 'path', binaryPath: '/opt/pi/bin/pi' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.12.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('treats a pi_binary_path declared without pi_binary as path mode', () => {
    const resolution = resolvePiBinarySelection(settings({ piBinaryPath: '/opt/pi/bin/pi' }), env({}));

    expect(resolution.selection).toEqual({ mode: 'path', binaryPath: '/opt/pi/bin/pi' });
  });

  it('warns that pi_binary_path is ignored in bundled mode', () => {
    const resolution = resolvePiBinarySelection(settings({ piBinary: 'bundled', piBinaryPath: '/opt/pi' }), env({}));

    expect(resolution.selection).toEqual({ mode: 'bundled' });
    expect(resolution.warnings).toHaveLength(1);
    expect(resolution.warnings[0]).toMatch(/ignored/);
  });

  it('launches bundled with no warning when auto finds the bundled binary', () => {
    const resolution = resolvePiBinarySelection(settings({ piBinary: 'auto' }), env({}), {
      bundledResolvable: () => true,
    });

    expect(resolution.selection).toEqual({ mode: 'bundled' });
    expect(resolution.warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.31).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to the PATH pi with a warning when auto cannot resolve the bundled binary', () => {
    const resolution = resolvePiBinarySelection(settings({ piBinary: 'auto' }), env({}), {
      bundledResolvable: () => false,
    });

    expect(resolution.selection).toEqual({ mode: 'path' });
    expect(resolution.warnings).toHaveLength(1);
    expect(resolution.warnings[0]).toMatch(/fallback|falling back/i);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.31).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails with an actionable error when a configured explicit binary does not exist', () => {
    for (const configured of [
      resolvePiBinarySelection(settings({ piBinary: 'path', piBinaryPath: '/no/such/pi' }), env({})),
      resolvePiBinarySelection(settings({}), env({ OUTFITTER_PI_BIN: '/no/such/pi' })),
    ]) {
      expect(configured.error).toBeInstanceOf(Error);
      expect(configured.error?.message).toContain('/no/such/pi');
      // The selection still names the configured path so a caller that ignores the error cannot
      // silently launch the bundled binary instead.
      expect(configured.selection).toEqual({ mode: 'path', binaryPath: '/no/such/pi' });
    }
  });
});
