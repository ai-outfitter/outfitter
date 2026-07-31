// Tests the harness layout registry that `outfitter link` projects through.
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HARNESS_IDS,
  HARNESS_LAYOUTS,
  LINKABLE_KINDS,
  findHarnessLayout,
  findHarnessSurface,
  isHarnessId,
  isLinkableKind,
  resolveHarnessConfigDirectory,
  supportedKinds,
} from '../../src/harness/HarnessLayout.js';

describe('harness registry', () => {
  it('declares a layout for every harness id, with unique config directories', () => {
    expect(HARNESS_LAYOUTS.map((layout) => layout.id)).toEqual([...HARNESS_IDS]);
    expect(new Set(HARNESS_LAYOUTS.map((layout) => layout.configDirectory)).size).toBe(HARNESS_LAYOUTS.length);
  });

  it('recognizes valid harness ids and linkable kinds', () => {
    expect(isHarnessId('claude')).toBe(true);
    expect(isHarnessId('emacs')).toBe(false);
    expect(isLinkableKind('skills')).toBe(true);
    expect(isLinkableKind('plugins')).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1.1, OFTR-011.1.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  // Note: this pins the declared surface, not that the harness reads it. OFTR-011.1.3 (surfaces
  // verified against an installed release) is a judgment requirement and is reviewed, not tested.
  it('places skills at <config>/skills for every harness, matching the shared SKILL.md layout', () => {
    for (const layout of HARNESS_LAYOUTS) {
      expect(findHarnessSurface(layout, 'skills')).toMatchObject({ strategy: 'symlink', location: 'skills' });
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1.1, OFTR-011.1.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('records each harness native instruction file and command surface strategy', () => {
    expect(findHarnessSurface(findHarnessLayout('claude'), 'instructions')?.location).toBe('CLAUDE.md');
    expect(findHarnessSurface(findHarnessLayout('codex'), 'instructions')?.location).toBe('AGENTS.md');
    expect(findHarnessSurface(findHarnessLayout('gemini'), 'instructions')?.location).toBe('GEMINI.md');

    // Codex reads custom prompts from prompts/, not commands/.
    expect(findHarnessSurface(findHarnessLayout('codex'), 'commands')?.location).toBe('prompts');
    // Gemini commands are TOML documents, so a symlink to Markdown would not load.
    expect(findHarnessSurface(findHarnessLayout('gemini'), 'commands')).toMatchObject({
      strategy: 'generate',
      extension: '.toml',
    });
    expect(findHarnessSurface(findHarnessLayout('claude'), 'commands')?.strategy).toBe('symlink');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('claims only skills for Copilot, and no hook surface for Codex or Copilot', () => {
    expect(supportedKinds(findHarnessLayout('copilot'))).toEqual(['skills']);
    expect(findHarnessSurface(findHarnessLayout('copilot'), 'instructions')).toBeUndefined();
    expect(findHarnessSurface(findHarnessLayout('codex'), 'hooks')).toBeUndefined();
    expect(findHarnessSurface(findHarnessLayout('copilot'), 'hooks')).toBeUndefined();
  });

  it('exposes only declared kinds, all of which are linkable', () => {
    for (const layout of HARNESS_LAYOUTS) {
      for (const kind of supportedKinds(layout)) {
        expect(LINKABLE_KINDS).toContain(kind);
      }
    }
  });

  it('resolves config directories under the injected home directory', () => {
    expect(resolveHarnessConfigDirectory(findHarnessLayout('claude'), '/home/me')).toBe(join('/home/me', '.claude'));
  });

  it('falls back to the process home directory when none is injected', () => {
    expect(resolveHarnessConfigDirectory(findHarnessLayout('gemini'))).toContain('.gemini');
  });
});
