// Tests pi projection of the `commands:` loadout into native prompt templates and the
// unsupported-element behavior on non-pi harnesses.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { ResolvedResource } from '../../src/resolver/Resource.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-cmdproj-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const layerRoot = (dir: string): string => join(dir, 'commands');

const command = (slug: string, dir: string): ResolvedResource => ({
  kind: 'command',
  slug,
  winner: {
    kind: 'command',
    slug,
    layer: { root: layerRoot(dir), origin: 'workspace', label: 'workspace' },
    path: join(layerRoot(dir), slug),
  },
  shadowed: [],
});

const planWithCommands = (commands: readonly ResolvedResource[]): CompositionPlan => ({
  agent: 'agent',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    commands,
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    extensionDeclarations: [],
    plugins: [],
  },
  warnings: [],
});

const WRITE_COMMAND_CONTENT = '---\ndescription: Review staged changes\nargument-hint: "<pr>"\n---\nReview $1.';

describe('pi commands projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.36).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes selected commands verbatim into prompts/ with no new launch flags', () => {
    const dir = root();
    const source = join(dir, 'commands', 'review-pr.md');
    write(source, WRITE_COMMAND_CONTENT);

    const projection = projectComposition(planWithCommands([command('review-pr.md', dir)]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(readFileSync(join(dir, 'prompts', 'review-pr.md'), 'utf8')).toBe(WRITE_COMMAND_CONTENT);
    expect(projection.unsupported).toEqual([]);
    expect(projection.launch.args.join(' ')).not.toContain('review-pr');
  });

  it('flattens nested command slugs into prompt names', () => {
    const dir = root();
    const source = join(dir, 'commands', 'deploy', 'staging.md');
    write(source, 'staging steps');

    projectComposition(planWithCommands([command('deploy/staging.md', dir)]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(readFileSync(join(dir, 'prompts', 'deploy-staging.md'), 'utf8')).toBe('staging steps');
  });

  it('skips a later command whose flattened name collides and reports it', () => {
    const dir = root();
    const first = join(dir, 'commands', 'a-b.md');
    const second = join(dir, 'commands', 'a', 'b.md');
    write(first, 'first');
    write(second, 'second');

    const projection = projectComposition(planWithCommands([command('a-b.md', dir), command('a/b.md', dir)]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(readFileSync(join(dir, 'prompts', 'a-b.md'), 'utf8')).toBe('first');
    expect(projection.unsupported).toContain("command:a/b.md (prompt name 'a-b' already materialized from 'a-b.md')");
  });

  it('reports non-md commands as unsupported instead of writing inert files', () => {
    const dir = root();
    const source = join(dir, 'commands', 'rotate-keys.sh');
    write(source, '#!/bin/sh\n');

    const projection = projectComposition(planWithCommands([command('rotate-keys.sh', dir)]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(projection.unsupported).toContain('command:rotate-keys.sh (only .md files load as pi prompt templates)');
  });

  it('skips command files that escape their layer root', () => {
    const dir = root();
    const outside = join(dir, 'outside.md');
    write(outside, 'secret');
    const linkDir = layerRoot(dir);
    mkdirSync(linkDir, { recursive: true });
    symlinkSync(outside, join(linkDir, 'leak.md'));

    const projection = projectComposition(planWithCommands([command('leak.md', dir)]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(projection.unsupported).toEqual(['command:leak.md (escaping path)']);
  });
});

describe('non-pi commands projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.36).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports commands as an unsupported loadout element for claude and codex', () => {
    const dir = root();
    const source = join(dir, 'commands', 'review-pr.md');
    write(source, WRITE_COMMAND_CONTENT);
    const plan = planWithCommands([command('review-pr.md', dir)]);

    const claude = projectComposition(plan, { harness: 'claude', rootDirectory: dir, homeDirectory: dir });
    const codex = projectComposition(plan, {
      harness: 'codex',
      rootDirectory: join(dir, 'codex'),
      homeDirectory: dir,
    });

    expect(claude.unsupported).toContain('commands');
    expect(codex.unsupported).toContain('commands');
    expect(existsSync(join(dir, 'prompts'))).toBe(false);
  });
});
