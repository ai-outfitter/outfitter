// Tests the agent-scoped `list` effective view: inherited skills/commands with owner provenance,
// owned-winner precedence, exact text labels, stable additive JSON, and unchanged non-inherited output.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createListCommand } from '../../src/cli/commands/ListCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-list-effective-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const skill = (name: string): string => `---\nname: ${name}\n---\n\n${name}\n`;

interface CatalogFixture {
  readonly root: string;
  readonly home: string;
  readonly project: string;
}

/** Builds a layered catalog: parent `coding` declares loadouts, child `apprentice` inherits. */
const catalog = (): CatalogFixture => {
  const root = createTemporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(join(project, '.agents', 'skills', 'shared', 'SKILL.md'), skill('shared'));
  write(join(project, '.agents', 'commands', 'deploy.md'), '# Deploy\n');
  write(join(project, '.agents', 'knowledge', 'guide.md'), '# Guide\n');
  write(
    join(project, '.agents', 'agents', 'coding', 'agent.md'),
    '---\nname: coding\nskills: [review]\n---\n\nBody.\n',
  );
  write(join(project, '.agents', 'agents', 'coding', 'skills', 'review', 'SKILL.md'), skill('review'));
  write(
    join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
    '---\nname: apprentice\ninherits: coding\n---\n\nBody.\n',
  );
  return { root, home, project };
};

const listLines = async (fixture: CatalogFixture, args: string[]): Promise<string[]> => {
  const lines: string[] = [];
  const program = new Command();
  createListCommand({
    homeDirectory: fixture.home,
    projectDirectory: fixture.project,
    writeLine: (message: string) => lines.push(message),
  }).register(program);
  await program.parseAsync(['node', 'outfitter', 'list', ...args]);
  return lines;
};

const listJson = async <T>(fixture: CatalogFixture, args: string[]): Promise<T> => {
  const lines = await listLines(fixture, [...args, '--json']);
  return JSON.parse(lines.join('\n')) as T;
};

describe('list agent effective view (skills)', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.8.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('shows inherited skills with declaring-owner provenance', async () => {
    const fixture = catalog();
    const lines = await listLines(fixture, ['skills', '--agent', 'apprentice']);

    expect(lines).toEqual([
      'skills (agent apprentice):',
      '  review  [workspace; inherited; owner: coding; agent-local]',
      '  shared  [workspace]',
    ]);
  });

  it('labels an inherited catalog-wide resolution without the agent-local token', async () => {
    const fixture = catalog();
    const lines = await listLines(fixture, ['skills', '--agent', 'apprentice']);
    const entry = (
      await listJson<{ resources: Record<string, unknown>[] }>(fixture, ['skills', '--agent', 'apprentice'])
    ).resources.find((resource) => resource['slug'] === 'review');

    expect(lines.join('\n')).toContain('  review  [workspace; inherited; owner: coding; agent-local]');
    expect(entry).toMatchObject({ slug: 'review', inherited: true, declaredBy: 'coding', ownerAgent: 'coding' });
  });

  it('resolves an inherited selection without an owner-local copy against the catalog', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'shared', 'SKILL.md'), skill('shared'));
    write(
      join(project, '.agents', 'agents', 'coding', 'agent.md'),
      '---\nname: coding\nskills: [shared]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: coding\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['skills', '--agent', 'apprentice']);

    expect(lines).toEqual(['skills (agent apprentice):', '  shared  [workspace; inherited; owner: coding]']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.10.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('satisfies a parent-declared selection from the parent namespace, never the child namespace', async () => {
    const fixture = catalog();
    const json = await listJson<{ resources: { slug: string; path: string; ownerAgent: string | null }[] }>(fixture, [
      'skills',
      '--agent',
      'apprentice',
    ]);
    const review = json.resources.find((resource) => resource['slug'] === 'review');

    expect(review?.path).toBe(join(fixture.project, '.agents', 'agents', 'coding', 'skills', 'review', 'SKILL.md'));
    expect(review?.ownerAgent).toBe('coding');
  });

  it('shows the owned winner once and omits the shadowed inherited duplicate', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'debug', 'SKILL.md'), skill('debug'));
    write(
      join(project, '.agents', 'agents', 'coding', 'agent.md'),
      '---\nname: coding\nskills: [debug]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: coding\nskills: [debug]\n---\n\nBody.\n',
    );
    write(join(project, '.agents', 'agents', 'apprentice', 'skills', 'debug', 'SKILL.md'), skill('debug'));

    const lines = await listLines({ root, home, project }, ['skills', '--agent', 'apprentice']);
    const json = await listJson<{ resources: { slug: string }[] }>({ root, home, project }, [
      'skills',
      '--agent',
      'apprentice',
    ]);

    expect(lines).toEqual(['skills (agent apprentice):', '  debug  [workspace; agent-local]']);
    expect(json.resources).toHaveLength(1);
  });

  it('composes multi-generation selections parent-first with de-duplication', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    for (const name of ['alpha', 'beta', 'gamma']) {
      write(join(project, '.agents', 'skills', name, 'SKILL.md'), skill(name));
    }
    write(
      join(project, '.agents', 'agents', 'grandparent', 'agent.md'),
      '---\nname: grandparent\nskills: [alpha, beta]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'parent', 'agent.md'),
      '---\nname: parent\ninherits: grandparent\nskills: [beta, gamma]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'child', 'agent.md'),
      '---\nname: child\ninherits: parent\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['skills', '--agent', 'child']);

    expect(lines).toEqual([
      'skills (agent child):',
      '  alpha  [workspace; inherited; owner: grandparent]',
      '  beta  [workspace; inherited; owner: grandparent]',
      '  gamma  [workspace; inherited; owner: parent]',
    ]);
  });
});

describe('list agent effective view (commands)', () => {
  it('shows inherited commands with declaring-owner provenance', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'commands', 'deploy.md'), '# Deploy\n');
    write(
      join(project, '.agents', 'agents', 'coding', 'agent.md'),
      '---\nname: coding\ncommands: [deploy]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: coding\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['commands', '--agent', 'apprentice']);

    expect(lines).toEqual(['commands (agent apprentice):', '  deploy.md  [workspace; inherited; owner: coding]']);
  });

  it('labels an inherited owner-local command with the agent-local token', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'coding', 'commands', 'ship.md'), '# Ship\n');
    write(
      join(project, '.agents', 'agents', 'coding', 'agent.md'),
      '---\nname: coding\ncommands: [ship]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: coding\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['commands', '--agent', 'apprentice']);

    expect(lines).toEqual([
      'commands (agent apprentice):',
      '  ship.md  [workspace; inherited; owner: coding; agent-local]',
    ]);
  });
});

describe('list agent effective view (unchanged surfaces)', () => {
  it('keeps the knowledge listing free of inheritance provenance', async () => {
    const fixture = catalog();
    const lines = await listLines(fixture, ['knowledge', '--agent', 'apprentice']);

    expect(lines).toEqual(['knowledge (agent apprentice):', '  guide.md  [workspace]']);
  });

  it('keeps output byte-identical for an agent without inherits', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'common', 'SKILL.md'), skill('common'));
    write(join(project, '.agents', 'agents', 'solo', 'agent.md'), '---\nname: solo\n---\n\nBody.\n');
    write(join(project, '.agents', 'agents', 'solo', 'skills', 'private', 'SKILL.md'), skill('private'));

    const lines = await listLines({ root, home, project }, ['skills', '--agent', 'solo']);
    const json = await listJson<{ resources: Record<string, unknown>[] }>({ root, home, project }, [
      'skills',
      '--agent',
      'solo',
    ]);

    expect(lines).toEqual(['skills (agent solo):', '  common  [workspace]', '  private  [workspace; agent-local]']);
    expect(json.resources).toHaveLength(2);
    for (const entry of json.resources) {
      expect(entry).not.toHaveProperty('inherited');
      expect(entry).not.toHaveProperty('declaredBy');
    }
  });
});

describe('list agent effective view (diagnostics and JSON stability)', () => {
  it('warns in composer format and omits an unresolved inherited selection', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'coding', 'agent.md'),
      '---\nname: coding\nskills: [ghost]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: coding\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['skills', '--agent', 'apprentice']);

    expect(lines).toEqual([
      "warning: loadout skills references unknown skill 'ghost'.",
      'skills (agent apprentice):',
      '  (none)',
    ]);
  });

  it('warns in composer format and omits an unknown inherited command reference', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'coding', 'agent.md'),
      '---\nname: coding\ncommands: [ghost]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: coding\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['commands', '--agent', 'apprentice']);

    expect(lines).toEqual([
      "warning: loadout commands references unknown command 'ghost'.",
      'commands (agent apprentice):',
      '  (none)',
    ]);
  });

  it('warns on an ambiguous inherited command reference', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'commands', 'a-ambig.md'), 'one');
    write(join(project, '.agents', 'commands', 'a', 'ambig.md'), 'two');
    write(
      join(project, '.agents', 'agents', 'coding', 'agent.md'),
      '---\nname: coding\ncommands: [a-ambig]\n---\n\nBody.\n',
    );
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: coding\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['commands', '--agent', 'apprentice']);

    expect(lines).toEqual([
      "warning: loadout commands references ambiguous command 'a-ambig' (a-ambig.md, a/ambig.md).",
      'commands (agent apprentice):',
      '  a-ambig.md  [workspace]',
      '  a/ambig.md  [workspace]',
    ]);
  });

  it('warns on a broken inheritance chain and still lists the resolvable surface', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'common', 'SKILL.md'), skill('common'));
    write(
      join(project, '.agents', 'agents', 'apprentice', 'agent.md'),
      '---\nname: apprentice\ninherits: ghost\n---\n\nBody.\n',
    );

    const lines = await listLines({ root, home, project }, ['skills', '--agent', 'apprentice']);

    expect(lines).toEqual([
      "warning: Agent inheritance references unknown parent 'ghost' in chain apprentice -> ghost.",
      'skills (agent apprentice):',
      '  common  [workspace]',
    ]);
  });

  it('emits byte-identical JSON across runs with provenance only on inherited entries', async () => {
    const fixture = catalog();
    const first = await listJson<{ resources: Record<string, unknown>[] }>(fixture, [
      'skills',
      '--agent',
      'apprentice',
    ]);
    const second = await listJson<{ resources: Record<string, unknown>[] }>(fixture, [
      'skills',
      '--agent',
      'apprentice',
    ]);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const inherited = first.resources.find((resource) => resource['slug'] === 'review');
    const owned = first.resources.find((resource) => resource['slug'] === 'shared');
    expect(inherited).toMatchObject({ inherited: true, declaredBy: 'coding' });
    expect(owned).not.toHaveProperty('inherited');
    expect(owned).not.toHaveProperty('declaredBy');
    for (const entry of first.resources) {
      expect(Object.keys(entry)).toEqual(expect.arrayContaining(['kind', 'slug', 'layer', 'path', 'ownerAgent']));
    }
  });
});
