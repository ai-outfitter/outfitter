// Tests the manifest-scoped cleanup contract for the runtime agents/ rebuild: Outfitter removes
// only the delegate files it generated (tracked by the rebuild manifest), foreign files survive,
// declared delegates win slug collisions, and an unusable manifest never causes deletions.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { materializeComposition } from '../../src/projection/Materialize.js';
import type { ResolvedResource } from '../../src/resolver/Resource.js';

const roots: string[] = [];
const newRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-subagents-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

const manifestPath = (root: string): string => join(root, '.outfitter', 'subagents.json');
const agentsDirectory = (root: string): string => join(root, 'agents');

/** A resolvable subagent definition under `<layerRoot>/agents/<slug>/agent.md`. */
const subagentResource = (layerRoot: string, slug: string, body = `# ${slug}\n`): ResolvedResource => {
  const definitionPath = join(layerRoot, 'agents', slug, 'agent.md');
  write(definitionPath, `---\nname: ${slug}\ndescription: ${slug} delegate.\n---\n\n${body}`);
  return {
    kind: 'agent',
    slug,
    winner: {
      kind: 'agent',
      slug,
      layer: { root: layerRoot, origin: 'workspace', label: 'workspace' },
      path: definitionPath,
    },
    shadowed: [],
  };
};

const planWith = (layerRoot: string, slugs: readonly string[]): CompositionPlan => ({
  agent: 'lead',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: slugs.map((slug) => subagentResource(layerRoot, slug)),
    mcp: [],
    mcpServers: {},
    extensions: [],
    extensionDeclarations: [],
    plugins: [],
  },
  warnings: [],
});

const project = (plan: CompositionPlan, root: string): void => {
  materializeComposition(plan, root, 'pi');
};

describe('subagent rebuild manifest', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves an overlay-provided agent definition when delegates are declared', () => {
    const root = newRoot();
    const overlayPath = join(agentsDirectory(root), 'general-purpose.md');
    write(overlayPath, 'OVERLAY GENERAL PURPOSE');
    const layerRoot = newRoot();

    project(planWith(layerRoot, ['reviewer']), root);

    expect(readFileSync(overlayPath, 'utf8')).toBe('OVERLAY GENERAL PURPOSE');
    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
  });

  it('keeps overlay-only runs untouched and manifest-free', () => {
    const root = newRoot();
    const overlayPath = join(agentsDirectory(root), 'general-purpose.md');
    write(overlayPath, 'OVERLAY GENERAL PURPOSE');
    const layerRoot = newRoot();

    project(planWith(layerRoot, []), root);

    expect(readFileSync(overlayPath, 'utf8')).toBe('OVERLAY GENERAL PURPOSE');
    expect(existsSync(manifestPath(root))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('cleans only stale generated delegates when the loadout shrinks', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    const overlayPath = join(agentsDirectory(root), 'general-purpose.md');
    write(overlayPath, 'OVERLAY GENERAL PURPOSE');

    project(planWith(layerRoot, ['reviewer', 'lead']), root);
    project(planWith(layerRoot, ['reviewer']), root);

    expect(existsSync(join(agentsDirectory(root), 'lead.md'))).toBe(false);
    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
    expect(readFileSync(overlayPath, 'utf8')).toBe('OVERLAY GENERAL PURPOSE');
  });

  it('cleans generated delegates and retires the manifest when shrinking to zero', () => {
    const root = newRoot();
    const layerRoot = newRoot();

    project(planWith(layerRoot, ['reviewer']), root);
    project(planWith(layerRoot, []), root);

    expect(existsSync(join(agentsDirectory(root), 'reviewer.md'))).toBe(false);
    expect(existsSync(manifestPath(root))).toBe(false);
  });

  it('resolves a slug collision in favor of the declared delegate', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    write(join(agentsDirectory(root), 'reviewer.md'), 'OVERLAY REVIEWER');

    project(planWith(layerRoot, ['reviewer']), root);

    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).not.toContain('OVERLAY REVIEWER');
  });

  it('tracks exactly the generated files with deterministic sorted relative paths', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    write(join(agentsDirectory(root), 'general-purpose.md'), 'OVERLAY');

    project(planWith(layerRoot, ['lead', 'reviewer']), root);

    const manifest = JSON.parse(readFileSync(manifestPath(root), 'utf8')) as { version: number; files: string[] };
    expect(manifest.version).toBe(1);
    expect(manifest.files).toEqual(['agents/lead.md', 'agents/reviewer.md']);
  });

  it('writes byte-identical manifests for identical projections', () => {
    const firstRoot = newRoot();
    const secondRoot = newRoot();
    const layerRoot = newRoot();

    project(planWith(layerRoot, ['reviewer']), firstRoot);
    project(planWith(layerRoot, ['reviewer']), secondRoot);

    expect(readFileSync(manifestPath(firstRoot), 'utf8')).toBe(readFileSync(manifestPath(secondRoot), 'utf8'));
  });

  it('treats a corrupt manifest as absent and deletes nothing foreign', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    const overlayPath = join(agentsDirectory(root), 'general-purpose.md');
    write(overlayPath, 'OVERLAY GENERAL PURPOSE');
    write(manifestPath(root), 'not-json{{{');

    project(planWith(layerRoot, ['reviewer']), root);

    expect(readFileSync(overlayPath, 'utf8')).toBe('OVERLAY GENERAL PURPOSE');
    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
    expect(JSON.parse(readFileSync(manifestPath(root), 'utf8'))).toMatchObject({ version: 1 });
  });

  it('ignores manifest paths outside the runtime root, and symlinks and directories at tracked paths', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    const outside = newRoot();
    const outsidePath = join(outside, 'victim.txt');
    write(outsidePath, 'OUTSIDE');
    write(join(agentsDirectory(root), 'keepdir', 'inner.md'), 'KEEP');
    symlinkSync(outsidePath, join(agentsDirectory(root), 'link.md'));
    write(
      manifestPath(root),
      JSON.stringify({ version: 1, files: [outsidePath, 'agents/link.md', 'agents/keepdir', '../escape.md'] }),
    );

    project(planWith(layerRoot, ['reviewer']), root);

    expect(readFileSync(outsidePath, 'utf8')).toBe('OUTSIDE');
    expect(existsSync(join(agentsDirectory(root), 'link.md'))).toBe(true);
    expect(existsSync(join(agentsDirectory(root), 'keepdir', 'inner.md'))).toBe(true);
    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
  });

  it('treats structurally invalid manifests as absent', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    const overlayPath = join(agentsDirectory(root), 'general-purpose.md');
    write(overlayPath, 'OVERLAY GENERAL PURPOSE');

    for (const raw of [
      '[]',
      '"manifest"',
      '{"version":2,"files":[]}',
      '{"version":1,"files":"agents/x.md"}',
      '{"version":1,"files":[42]}',
    ]) {
      write(manifestPath(root), raw);

      project(planWith(layerRoot, ['reviewer']), root);

      expect(readFileSync(overlayPath, 'utf8')).toBe('OVERLAY GENERAL PURPOSE');
    }
  });

  it('ignores manifest entries with unusable relative segments', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    write(join(agentsDirectory(root), 'keepme.md'), 'KEEP');
    write(
      manifestPath(root),
      JSON.stringify({ version: 1, files: ['agents//x.md', './agents/x.md', 'agents/./x.md'] }),
    );

    project(planWith(layerRoot, ['reviewer']), root);

    expect(readFileSync(join(agentsDirectory(root), 'keepme.md'), 'utf8')).toBe('KEEP');
    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
  });

  it('tolerates manifest entries whose files no longer exist', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    write(manifestPath(root), JSON.stringify({ version: 1, files: ['agents/vanished.md', 'agents/lead.md'] }));

    project(planWith(layerRoot, ['reviewer']), root);

    expect(existsSync(join(agentsDirectory(root), 'lead.md'))).toBe(false);
    expect(readFileSync(join(agentsDirectory(root), 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
  });

  it('never lets the manifest list foreign files', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    write(join(agentsDirectory(root), 'general-purpose.md'), 'OVERLAY');

    project(planWith(layerRoot, ['reviewer']), root);

    const manifest = JSON.parse(readFileSync(manifestPath(root), 'utf8')) as { files: string[] };
    expect(manifest.files).not.toContain('agents/general-purpose.md');
  });

  it('reports skipped subagents through the existing channel without tracking them', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    const plan = planWith(layerRoot, ['reviewer']);
    // A winner whose frontmatter name disagrees with the slug is skipped by materialization.
    const broken = subagentResource(layerRoot, 'broken');
    const definitionPath = join(layerRoot, 'agents', 'broken', 'agent.md');
    write(definitionPath, '---\nname: other-name\n---\n\nBody.\n');
    const planWithBroken: CompositionPlan = {
      ...plan,
      loadout: { ...plan.loadout, subagents: [...plan.loadout.subagents, broken] },
    };

    project(planWithBroken, root);

    const manifest = JSON.parse(readFileSync(manifestPath(root), 'utf8')) as { files: string[] };
    expect(manifest.files).toEqual(['agents/reviewer.md']);
    expect(existsSync(join(agentsDirectory(root), 'broken.md'))).toBe(false);
  });

  it('leaves no other files in the agents directory beyond tracked and foreign entries', () => {
    const root = newRoot();
    const layerRoot = newRoot();
    write(join(agentsDirectory(root), 'general-purpose.md'), 'OVERLAY');

    project(planWith(layerRoot, ['reviewer']), root);

    expect(readdirSync(agentsDirectory(root)).sort()).toEqual(['general-purpose.md', 'reviewer.md']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps pi/ overlay agent definitions alive in a run that declares subagents', async () => {
    const root = newRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\n---\n\nReview.\n');
    write(
      join(project, '.agents', 'agents', 'lead', 'agent.md'),
      '---\nname: lead\nsubagents: [reviewer]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'lead', 'pi', 'agents', 'general-purpose.md'),
      '---\nname: general-purpose\n---\n\nOverlay body.\n',
    );
    let overlayAtLaunch: string | undefined;
    let delegateAtLaunch: string | undefined;
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'lead',
      harness: 'pi',
      // The runtime root is removed after the launch exits, so the projection is read at launch time.
      launcher: (plan) => {
        const runtimeAgents = join(plan.env.PI_CODING_AGENT_DIR ?? '', 'agents');
        overlayAtLaunch = existsSync(join(runtimeAgents, 'general-purpose.md'))
          ? readFileSync(join(runtimeAgents, 'general-purpose.md'), 'utf8')
          : undefined;
        delegateAtLaunch = existsSync(join(runtimeAgents, 'reviewer.md'))
          ? readFileSync(join(runtimeAgents, 'reviewer.md'), 'utf8')
          : undefined;
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(overlayAtLaunch).toContain('Overlay body.');
    expect(delegateAtLaunch).toContain('name: "reviewer"');
  });
});
