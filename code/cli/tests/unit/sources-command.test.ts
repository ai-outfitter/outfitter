import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createSourcesCommand, executeSourcesCommand } from '../../src/cli/commands/SourcesCommand.js';
import { createRemoteRepositoryCachePath } from '../../src/sources/SourceCache.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('sources command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.24).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports stable redacted precedence for live and uncached sources', () => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-sources-'));
    roots.push(root);
    const home = join(root, 'home');
    const project = join(root, 'project');
    const settings = join(project, '.agents', 'settings.yml');
    mkdirSync(dirname(settings), { recursive: true });
    writeFileSync(
      settings,
      `remote_settings:\n  - uri: https://example.test/settings.git\n    path: settings.yml\nsources:\n  - path: ./local\n  - uri: https://user:secret@example.test/catalog.git\n`,
    );
    const remoteSource = { uri: 'https://user:secret@example.test/catalog.git' } as const;
    const cachedSettings = join(createRemoteRepositoryCachePath(home, remoteSource), 'settings.yml');
    mkdirSync(dirname(cachedSettings), { recursive: true });
    writeFileSync(cachedSettings, 'sources:\n  - github: example/dependency\n    ref: v1.0.0\n');

    const report = executeSourcesCommand({ homeDirectory: home, projectDirectory: project });
    expect(report.map((entry) => entry.precedence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(report[2]).toMatchObject({ origin: 'remote-settings', cacheHealth: 'missing' });
    expect(report[3]).toMatchObject({ origin: 'source', cacheHealth: 'live' });
    expect(report[4]).toMatchObject({ origin: 'source', cacheHealth: 'missing', requestedRevision: null });
    expect(report[5]).toMatchObject({ origin: 'transitive', requestedRevision: 'v1.0.0' });

    const lines: string[] = [];
    const program = new Command();
    createSourcesCommand({
      homeDirectory: home,
      projectDirectory: project,
      writeLine: (line) => lines.push(line),
    }).register(program);
    program.parse(['node', 'test', 'sources']);
    expect(lines).toHaveLength(6);
    lines.length = 0;
    program.parse(['node', 'test', 'sources', '--json']);
    expect(JSON.parse(lines[0])).toEqual(report);
  });
});
