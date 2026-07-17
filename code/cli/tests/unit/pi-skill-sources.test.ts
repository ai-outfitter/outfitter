// Tests resolution of profile-declared Pi skill sources against layer roots.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiSkillSources } from '../../src/agents/pi/PiSkillSources.js';
import type { AgentLaunchProfileLayer } from '../../src/agents/AgentAdapter.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi skill sources', () => {
  it('resolves .outfitter-relative skills against the conventional root of the declaring layer', () => {
    const repoRoot = createTemporaryRoot();
    const skillFolder = join(repoRoot, '.outfitter', 'skills', 'project-setup');
    mkdirSync(skillFolder, { recursive: true });
    writeFileSync(join(skillFolder, 'SKILL.md'), '# project setup\n');
    const layer = createLayer({
      profilePath: join(repoRoot, '.outfitter', 'profiles', 'founder.yml'),
      sourceRootPath: join(repoRoot, '.outfitter', 'profiles'),
    });

    const skillSources = createPiSkillSources({
      builtInOutfitterSkill: '/built-in/outfitter',
      controls: { skills: ['.outfitter/skills/project-setup'] },
      profileFolders: [],
      profileLayers: [layer],
    });

    expect(skillSources).toContain(skillFolder);
    expect(skillSources).not.toContain('.outfitter/skills/project-setup');
  });

  it('keeps unresolvable relative skills unchanged', () => {
    const repoRoot = createTemporaryRoot();
    const layer = createLayer({
      profilePath: join(repoRoot, '.outfitter', 'profiles', 'founder.yml'),
      sourceRootPath: join(repoRoot, '.outfitter', 'profiles'),
    });

    const skillSources = createPiSkillSources({
      builtInOutfitterSkill: '/built-in/outfitter',
      controls: { skills: ['.outfitter/skills/missing'] },
      profileFolders: [],
      profileLayers: [layer],
    });

    expect(skillSources).toContain('.outfitter/skills/missing');
  });
});

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-skill-sources-'));
  temporaryRoots.push(root);
  return root;
};

const createLayer = (input: {
  readonly profilePath: string;
  readonly sourceRootPath: string;
}): AgentLaunchProfileLayer => ({
  profile: { id: 'founder', inherits: [], controls: {} },
  profilePath: input.profilePath,
  sourceRootPath: input.sourceRootPath,
  layout: 'flat-file',
});
