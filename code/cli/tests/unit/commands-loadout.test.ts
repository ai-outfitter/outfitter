// Tests the `commands:` loadout selector: schema grammar, resolution precedence, ambiguity,
// inheritance, and validation of unresolved/ambiguous references.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { compose } from '../../src/composer/Composer.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-commands-'));
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

const agent = (name: string, loadout: string): string => `---\nname: ${name}\n${loadout}\n---\n\nBody.\n`;

const resolveSet = (home: string, project: string) =>
  resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers);

describe('commands loadout schema grammar', () => {
  it('accepts a list of non-empty string slugs', () => {
    const result = validateSchema('agent', { name: 'engineer', commands: ['review-pr', 'deploy/staging.md'] });
    expect(result.valid).toBe(true);
  });

  it('rejects non-array values, non-string entries, and empty entries', () => {
    expect(validateSchema('agent', { name: 'x', commands: 'review-pr' }).valid).toBe(false);
    expect(validateSchema('agent', { name: 'x', commands: [42] }).valid).toBe(false);
    expect(validateSchema('agent', { name: 'x', commands: [''] }).valid).toBe(false);
  });
});

describe('commands loadout resolution', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.6.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves bare names and exact slugs agent-local first, then catalog-wide', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'commands', 'review-pr.md'), '# Review\n');
    write(join(project, '.agents', 'commands', 'rotate-keys.sh'), '#!/bin/sh\n');
    write(join(project, '.agents', 'agents', 'engineer', 'commands', 'deploy.md'), '# Deploy\n');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      agent('engineer', 'commands: [deploy, review-pr, rotate-keys, deploy.md]'),
    );

    const plan = compose(resolveSet(home, project), 'engineer').plan!;

    expect(plan.loadout.commands.map((command) => command.slug)).toEqual([
      'deploy.md',
      'review-pr.md',
      'rotate-keys.sh',
    ]);
    expect(plan.loadout.commands[0]?.winner.ownerAgent).toBe('engineer');
    expect(plan.loadout.commands[0]?.winner.path).toBe(
      join(project, '.agents', 'agents', 'engineer', 'commands', 'deploy.md'),
    );
  });

  it('prefers the highest layer for the same command slug', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'commands', 'review-pr.md'), 'global');
    write(join(project, '.agents', 'commands', 'review-pr.md'), 'workspace');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer', 'commands: [review-pr]'));

    const plan = compose(resolveSet(home, project), 'engineer').plan!;

    expect(plan.loadout.commands[0]?.winner.path).toBe(join(project, '.agents', 'commands', 'review-pr.md'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.6.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves a unique .md name over same-name siblings and reports ambiguity otherwise', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'commands', 'review-pr.md'), 'md');
    write(join(project, '.agents', 'commands', 'review-pr.txt'), 'txt');
    write(join(project, '.agents', 'commands', 'a-ambig.md'), 'one');
    write(join(project, '.agents', 'commands', 'a', 'ambig.md'), 'two');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      agent('engineer', 'commands: [review-pr, a-ambig]'),
    );

    const result = compose(resolveSet(home, project), 'engineer');

    expect(result.plan?.loadout.commands.map((command) => command.slug)).toEqual(['review-pr.md']);
    expect(result.warnings).toEqual([
      "loadout commands references ambiguous command 'a-ambig' (a-ambig.md, a/ambig.md).",
    ]);
  });

  it('does not stem-match entries that carry a dot', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'commands', 'review-pr.md'), 'md');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer', 'commands: [review-pr.txt]'));

    const result = compose(resolveSet(home, project), 'engineer');

    expect(result.plan?.loadout.commands).toEqual([]);
    expect(result.warnings).toEqual(["loadout commands references unknown command 'review-pr.txt'."]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.10.2, OFTR-003.10.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges inherited commands parent-first with deduplication and declaring-owner provenance', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'commands', 'shared.md'), 'catalog shared');
    write(join(project, '.agents', 'agents', 'base', 'commands', 'private.md'), 'base private');
    write(join(project, '.agents', 'agents', 'base', 'agent.md'), agent('base', 'commands: [private]'));
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      agent('engineer', 'inherits: base\ncommands: [private, shared]'),
    );

    const plan = compose(resolveSet(home, project), 'engineer').plan!;

    expect(plan.loadout.commands.map((command) => command.slug)).toEqual(['private.md', 'shared.md']);
    expect(plan.loadout.commands[0]?.winner.ownerAgent).toBe('base');
  });
});

describe('commands loadout validation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports unresolved and ambiguous references as errors', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'commands', 'a-ambig.md'), 'one');
    write(join(project, '.agents', 'commands', 'a', 'ambig.md'), 'two');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer', 'commands: [ghost, a-ambig]'));

    const findings = validateEffectiveSet(resolveSet(home, project));

    expect(findings).toContainEqual({
      severity: 'error',
      resource: 'agent:engineer',
      message: "loadout commands references unknown command 'ghost'.",
    });
    expect(
      findings.some(
        (finding) =>
          finding.severity === 'error' &&
          finding.message.startsWith("loadout commands references ambiguous command 'a-ambig'"),
      ),
    ).toBe(true);
  });

  it('defers unresolved command references to warnings during isolated sync validation', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer', 'commands: [ghost]'));

    const findings = validateEffectiveSet(resolveSet(home, project), undefined, { deferLoadoutResolution: true });

    expect(findings).toContainEqual({
      severity: 'warning',
      resource: 'agent:engineer',
      message: "loadout commands references unknown command 'ghost'.",
    });
  });
});
