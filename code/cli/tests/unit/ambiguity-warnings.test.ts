import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { createListCommand, executeListCommand } from '../../src/cli/commands/ListCommand.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { createSyncCommand, executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-ambiguity-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const resource = (root: string, kind: 'agents' | 'skills', slug: string): void => {
  const filename = kind === 'agents' ? 'agent.md' : 'SKILL.md';
  write(join(root, kind, slug, filename), `---\nname: ${slug}\n---\n\n${root}\n`);
};

const resolve = (root: string) =>
  resolveEffectiveSet({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') });

const runnableAgent = (root: string): void => resource(join(root, 'project', '.agents'), 'agents', 'engineer');

const run = (root: string, strict: boolean) =>
  executeRunAgentCommand({
    homeDirectory: join(root, 'home'),
    projectDirectory: join(root, 'project'),
    agent: 'engineer',
    strict,
    launcher: () => Promise.resolve(0),
    sourceCachePreparer: () => ({ messages: [] }),
  });

afterEach(() => {
  process.exitCode = undefined;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('ambiguous source resolution warnings', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.1, OFTR-004.7.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('names both declaring settings layers and refs, the winner, and preserves source precedence', () => {
    const root = createTemporaryRoot();
    write(
      join(root, 'home', '.agents', 'settings.yml'),
      'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.2.1\n',
    );
    write(
      join(root, 'project', '.agents', 'settings.yml'),
      'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.2.0\n',
    );

    const result = resolve(root);
    const warning = result.ambiguityWarnings.find((message) => message.includes('community-profiles'));

    expect(warning).toContain(join(root, 'home', '.agents', 'settings.yml'));
    expect(warning).toContain('v1.2.1');
    expect(warning).toContain(join(root, 'project', '.agents', 'settings.yml'));
    expect(warning).toContain('v1.2.0');
    expect(warning).toContain(`'${join(root, 'project', '.agents', 'settings.yml')}' at ref 'v1.2.0' won`);
    expect(result.settings.sources).toEqual([{ github: 'ai-outfitter/community-profiles', ref: 'v1.2.0' }]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.2, OFTR-004.7.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when a project source list drops a different repository declared by the user scope', () => {
    const root = createTemporaryRoot();
    const userSettings = join(root, 'home', '.agents', 'settings.yml');
    const projectSettings = join(root, 'project', '.agents', 'settings.yml');
    write(userSettings, 'sources:\n  - github: ai-outfitter/.agents\n');
    write(projectSettings, 'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.2.0\n');

    const result = resolve(root);
    const warning = result.ambiguityWarnings.find((message) => message.includes('github:ai-outfitter/.agents'));

    expect(warning).toContain(`declared by '${userSettings}'`);
    expect(warning).toContain(`replaced by '${projectSettings}'`);
    expect(warning).toContain('is not in the effective configuration');
    expect(result.settings.sources).toEqual([{ github: 'ai-outfitter/community-profiles', ref: 'v1.2.0' }]);
    expect(result.settings.sources).not.toContainEqual({ github: 'ai-outfitter/.agents' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.3, OFTR-004.7.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when two sources supply an agent slug, names both sources and the unchanged winner', () => {
    const root = createTemporaryRoot();
    const winner = join(root, 'winner');
    const shadowed = join(root, 'shadowed');
    resource(winner, 'agents', 'actions-agent');
    resource(shadowed, 'agents', 'actions-agent');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${winner}\n  - path: ${shadowed}\n`);

    const result = resolve(root);
    const warning = result.warnings.find((message) => message.includes("agent slug 'actions-agent'"));

    expect(warning).toContain(winner);
    expect(warning).toContain(shadowed);
    expect(warning).toContain(`'${winner}' won`);
    expect(findResource(result.set, 'agent', 'actions-agent')?.winner.layer.label).toBe(winner);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns when two sources supply a skill slug and names the winner', () => {
    const root = createTemporaryRoot();
    const winner = join(root, 'skills-one');
    const shadowed = join(root, 'skills-two');
    resource(winner, 'skills', 'triage');
    resource(shadowed, 'skills', 'triage');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${winner}\n  - path: ${shadowed}\n`);

    const warning = resolve(root).warnings.find((message) => message.includes("skill slug 'triage'"));

    expect(warning).toContain(winner);
    expect(warning).toContain(shadowed);
    expect(warning).toContain(`'${winner}' won`);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('surfaces ambiguity warnings in diagnostic commands and keeps normal run quiet', async () => {
    const root = createTemporaryRoot();
    const winner = join(root, 'catalog-one');
    const shadowed = join(root, 'catalog-two');
    resource(winner, 'agents', 'actions-agent');
    resource(shadowed, 'agents', 'actions-agent');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${winner}\n  - path: ${shadowed}\n`);
    const input = { homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') };
    const isAmbiguityWarning = (message: string): boolean => message.includes("Ambiguous agent slug 'actions-agent'");

    expect(executeSyncCommand(input).messages.some(isAmbiguityWarning)).toBe(true);
    expect(executeValidateCommand(input).messages.some(isAmbiguityWarning)).toBe(true);
    expect(executeListCommand({ ...input, kind: 'agents' }).messages.some(isAmbiguityWarning)).toBe(true);
    const run = await executeRunAgentCommand({
      ...input,
      agent: 'actions-agent',
      launcher: () => Promise.resolve(0),
    });
    expect(run.messages.some(isAmbiguityWarning)).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.1, OFTR-004.7.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not report ambiguity for a clean effective configuration', () => {
    const root = createTemporaryRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    resource(first, 'agents', 'engineer');
    resource(second, 'skills', 'research');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${first}\n  - path: ${second}\n`);

    expect(resolve(root).warnings.filter((message) => message.includes('Ambiguous'))).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a dropped repository once when a higher-precedence empty list excludes duplicate declarations', () => {
    const root = createTemporaryRoot();
    write(
      join(root, 'home', '.agents', 'settings.yml'),
      'sources:\n  - github: acme/catalog\n    ref: v1.0.0\n  - github: acme/catalog\n    ref: v2.0.0\n',
    );
    write(join(root, 'project', '.agents', 'settings.yml'), 'sources: []\n');

    const warnings = resolve(root).ambiguityWarnings;

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("source 'github:acme/catalog'");
    expect(warnings[0]).toContain(join(root, 'home', '.agents', 'settings.yml'));
    expect(warnings[0]).toContain(join(root, 'project', '.agents', 'settings.yml'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.1, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes a source ref conflict fatal for run under strict mode', async () => {
    const root = createTemporaryRoot();
    runnableAgent(root);
    write(
      join(root, 'project', '.agents', 'settings.yml'),
      'sources:\n  - github: acme/catalog\n    ref: v1\n  - github: acme/catalog\n    ref: v2\n',
    );

    const result = await run(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(
      result.messages.some((message) => message.includes("Ambiguous source repository 'github:acme/catalog'")),
    ).toBe(true);
    expect(result.messages.at(-1)).toBe('Strict mode: ambiguous resolution is fatal.');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.3, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes a supplier slug collision fatal for run under strict mode', async () => {
    const root = createTemporaryRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    runnableAgent(root);
    resource(first, 'skills', 'shared');
    resource(second, 'skills', 'shared');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${first}\n  - path: ${second}\n`);

    const result = await run(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(result.messages.some((message) => message.includes("Ambiguous skill slug 'shared'"))).toBe(true);
    expect(result.messages.at(-1)).toBe('Strict mode: ambiguous resolution is fatal.');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.2, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes a dropped-source replacement fatal for run under strict mode', async () => {
    const root = createTemporaryRoot();
    runnableAgent(root);
    write(join(root, 'home', '.agents', 'settings.yml'), 'sources:\n  - github: acme/user-catalog\n');
    write(join(root, 'project', '.agents', 'settings.yml'), 'sources: []\n');

    const result = await run(root, true);

    expect(result.exitCode).not.toBe(0);
    expect(result.messages.some((message) => message.includes("source 'github:acme/user-catalog'"))).toBe(true);
    expect(result.messages.at(-1)).toBe('Strict mode: ambiguous resolution is fatal.');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.4, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('gates ambiguity in strict sync, validate, and list while a clean strict configuration succeeds', async () => {
    const ambiguousRoot = createTemporaryRoot();
    const first = join(ambiguousRoot, 'first');
    const second = join(ambiguousRoot, 'second');
    resource(first, 'skills', 'shared');
    resource(second, 'skills', 'shared');
    write(
      join(ambiguousRoot, 'project', '.agents', 'settings.yml'),
      `sources:\n  - path: ${first}\n  - path: ${second}\n`,
    );
    const ambiguousInput = {
      homeDirectory: join(ambiguousRoot, 'home'),
      projectDirectory: join(ambiguousRoot, 'project'),
      strict: true,
    };

    expect(executeSyncCommand(ambiguousInput).exitCode).not.toBe(0);
    expect(executeValidateCommand(ambiguousInput).ok).toBe(false);
    expect(executeListCommand({ ...ambiguousInput, kind: 'agents' }).exitCode).not.toBe(0);

    const cleanRoot = createTemporaryRoot();
    runnableAgent(cleanRoot);
    const cleanInput = {
      homeDirectory: join(cleanRoot, 'home'),
      projectDirectory: join(cleanRoot, 'project'),
      strict: true,
    };

    expect(executeSyncCommand(cleanInput).exitCode).toBe(0);
    expect(executeValidateCommand(cleanInput).ok).toBe(true);
    expect(executeListCommand({ ...cleanInput, kind: 'agents' }).exitCode).toBe(0);
    expect((await run(cleanRoot, true)).exitCode).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.4, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts --strict through the sync and list command-line interfaces', async () => {
    const root = createTemporaryRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    resource(first, 'skills', 'shared');
    resource(second, 'skills', 'shared');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${first}\n  - path: ${second}\n`);
    const lines: string[] = [];
    const dependencies = {
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      writeLine: (message: string) => lines.push(message),
    };

    const syncProgram = new Command();
    createSyncCommand(dependencies).register(syncProgram);
    await syncProgram.parseAsync(['node', 'outfitter', 'sync', '--strict']);
    expect(process.exitCode).toBe(1);
    expect(lines.at(-1)).toBe('failed: Strict mode: ambiguous resolution is fatal.');

    process.exitCode = undefined;
    lines.length = 0;
    const listProgram = new Command();
    createListCommand(dependencies).register(listProgram);
    await listProgram.parseAsync(['node', 'outfitter', 'list', 'agents', '--strict']);
    expect(process.exitCode).toBe(1);
    expect(lines.at(-1)).toBe('error: Strict mode: ambiguous resolution is fatal.');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.4, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('gates dump ambiguity under --strict while keeping it advisory by default', async () => {
    const root = createTemporaryRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    resource(first, 'agents', 'engineer');
    resource(second, 'agents', 'engineer');
    write(join(root, 'project', '.agents', 'settings.yml'), `sources:\n  - path: ${first}\n  - path: ${second}\n`);
    const lines: string[] = [];
    const dependencies = {
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      writeLine: (message: string) => lines.push(message),
    };

    const strictProgram = new Command();
    createDumpCommand(dependencies).register(strictProgram);
    await strictProgram.parseAsync([
      'node',
      'outfitter',
      'dump',
      '--agent',
      'engineer',
      '--out',
      join(root, 'strict-dump'),
      '--strict',
    ]);
    expect(process.exitCode).toBe(1);
    expect(lines.some((message) => message.includes("Ambiguous agent slug 'engineer'"))).toBe(true);
    expect(lines.at(-1)).toBe('error: Strict mode: ambiguous resolution is fatal.');

    process.exitCode = undefined;
    lines.length = 0;
    const advisoryProgram = new Command();
    createDumpCommand(dependencies).register(advisoryProgram);
    await advisoryProgram.parseAsync([
      'node',
      'outfitter',
      'dump',
      '--agent',
      'engineer',
      '--out',
      join(root, 'advisory-dump'),
    ]);
    expect(process.exitCode).toBeUndefined();
    expect(lines.some((message) => message.includes("Ambiguous agent slug 'engineer'"))).toBe(true);
    expect(lines.some((message) => message.startsWith("Dumped 'engineer'"))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.4, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('suppresses ambiguity diagnostics outside strict mode', async () => {
    const root = createTemporaryRoot();
    runnableAgent(root);
    write(join(root, 'home', '.agents', 'settings.yml'), 'sources:\n  - github: acme/user-catalog\n');
    write(join(root, 'project', '.agents', 'settings.yml'), 'sources: []\n');

    const result = await run(root, false);

    expect(result.exitCode).toBe(0);
    expect(result.messages.some((message) => message.includes("source 'github:acme/user-catalog'"))).toBe(false);
    expect(result.messages).not.toContain('Strict mode: ambiguous resolution is fatal.');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.7.1, OFTR-004.7.2, OFTR-004.7.3, OFTR-004.7.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports every ambiguity before strict mode fails', async () => {
    const root = createTemporaryRoot();
    const first = join(root, 'first');
    const second = join(root, 'second');
    runnableAgent(root);
    resource(first, 'skills', 'shared');
    resource(second, 'skills', 'shared');
    write(join(root, 'home', '.agents', 'settings.yml'), 'sources:\n  - github: acme/dropped\n');
    write(
      join(root, 'project', '.agents', 'settings.yml'),
      `sources:\n  - github: acme/catalog\n    ref: v1\n  - github: acme/catalog\n    ref: v2\n  - path: ${first}\n  - path: ${second}\n`,
    );

    const result = await run(root, true);
    const failureIndex = result.messages.indexOf('Strict mode: ambiguous resolution is fatal.');
    const ambiguityIndexes = [
      result.messages.findIndex((message) => message.includes("source 'github:acme/dropped'")),
      result.messages.findIndex((message) => message.includes("Ambiguous source repository 'github:acme/catalog'")),
      result.messages.findIndex((message) => message.includes("Ambiguous skill slug 'shared'")),
    ];

    expect(ambiguityIndexes.every((index) => index >= 0 && index < failureIndex)).toBe(true);
    expect(failureIndex).toBe(result.messages.length - 1);
  });
});
