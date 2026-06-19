// Tests Pi settings array policies and package/extension reconciliation helpers.
import { describe, expect, it } from 'vitest';

import { mergeArrayByPolicy } from '../../src/merge/ArrayMergePolicy.js';
import {
  filterPiSettingsPackagesDuplicatingExtensions,
  normalizePiSettingsPackageResourceIdentity,
  piSettingsArrayPolicies,
  readPiSettingsPackageSource,
} from '../../src/agents/pi/PiSettingsMergePolicy.js';

describe('Pi settings merge policies', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('declares merge policies for Pi settings resource arrays', () => {
    expect(Object.keys(piSettingsArrayPolicies).sort()).toEqual([
      'extensions',
      'packages',
      'prompts',
      'skills',
      'themes',
    ]);

    expect(
      mergeArrayByPolicy(['npm:pi-subagents@1', 'npm:kept'], ['npm:pi-subagents@2'], piSettingsArrayPolicies.packages),
    ).toEqual(['npm:kept', 'npm:pi-subagents@2']);
    expect(
      mergeArrayByPolicy(
        ['npm:pi-subagents@1', { custom: true }],
        ['npm:pi-subagents@2'],
        piSettingsArrayPolicies.extensions,
      ),
    ).toEqual([{ custom: true }, 'npm:pi-subagents@2']);
    expect(
      mergeArrayByPolicy(['./skills/review', './skills/other'], ['./skills/review'], piSettingsArrayPolicies.skills),
    ).toEqual(['./skills/other', './skills/review']);
    expect(
      mergeArrayByPolicy(['./prompts/review.md'], ['./prompts/review.md'], piSettingsArrayPolicies.prompts),
    ).toEqual(['./prompts/review.md']);
    expect(mergeArrayByPolicy(['dark.json'], ['dark.json'], piSettingsArrayPolicies.themes)).toEqual(['dark.json']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('normalizes package entries and filters package duplicates of profile extensions', () => {
    const packages = [
      'npm:pi-subagents',
      { source: 'git+https://github.com/ai-outfitter/deepwork.git#main' },
      { source: 'npm:kept-package' },
      null,
    ];

    expect(readPiSettingsPackageSource(packages[0])).toBe('npm:pi-subagents');
    expect(readPiSettingsPackageSource(packages[1])).toBe('git+https://github.com/ai-outfitter/deepwork.git#main');
    expect(readPiSettingsPackageSource(null)).toBeUndefined();
    expect(readPiSettingsPackageSource([])).toBeUndefined();
    expect(readPiSettingsPackageSource({ source: 42 })).toBeUndefined();
    expect(normalizePiSettingsPackageResourceIdentity(undefined)).toBeUndefined();
    expect(normalizePiSettingsPackageResourceIdentity(packages[1])).toBe(
      'git:https://github.com/ai-outfitter/deepwork.git',
    );
    expect(
      filterPiSettingsPackagesDuplicatingExtensions(packages, [
        'npm:pi-subagents@2',
        'git:github.com/ai-outfitter/deepwork#v1',
      ]),
    ).toEqual([{ source: 'npm:kept-package' }, null]);
    expect(filterPiSettingsPackagesDuplicatingExtensions(packages, [])).toBe(packages);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps malformed package-like entries distinct when applying generic package dedupe', () => {
    expect(
      mergeArrayByPolicy(
        [{ b: 2, a: 1 }, ['nested'], null],
        [{ a: 1, b: 2 }, ['nested'], false],
        piSettingsArrayPolicies.packages,
      ),
    ).toEqual([null, { a: 1, b: 2 }, ['nested'], false]);
  });
});
