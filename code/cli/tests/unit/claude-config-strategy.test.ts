import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  describeInheritedClaudeConfiguration,
  missingClaudeInheritanceFlags,
  probeClaudeInheritance,
  resolveClaudeConfigStrategy,
} from '../../src/agents/ClaudeConfigStrategy.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Claude configuration strategy', () => {
  it.each([
    [undefined, undefined, 'inherit'],
    ['isolated', undefined, 'isolated'],
    ['isolated', 'inherit', 'inherit'],
    ['inherit', 'isolated', 'isolated'],
  ] as const)('resolves flag %s over setting %s with inherited default', (setting, requested, expected) => {
    expect(resolveClaudeConfigStrategy(setting, requested)).toBe(expected);
  });

  it('reports required flags absent from Claude help', () => {
    expect(missingClaudeInheritanceFlags('Usage: claude --plugin-dir <path>')).toEqual([]);
    expect(missingClaudeInheritanceFlags('Usage: claude')).toEqual(['--plugin-dir']);
  });

  it('probes supported and unavailable Claude builds', () => {
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 0, stdout: '--plugin-dir', stderr: '' } as never);
    expect(probeClaudeInheritance()).toEqual([]);

    vi.mocked(spawnSync).mockReturnValueOnce({
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('missing'),
    } as never);
    expect(probeClaudeInheritance()).toEqual(['--plugin-dir']);

    vi.mocked(spawnSync).mockReturnValueOnce({ status: 1, stdout: '', stderr: '' } as never);
    expect(probeClaudeInheritance()).toEqual(['--plugin-dir']);
  });

  it('summarizes inherited settings, MCP servers, and plugins', () => {
    const home = mkdtempSync(join(tmpdir(), 'outfitter-claude-strategy-'));
    roots.push(home);
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { a: true, b: false } }));
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { one: {}, two: {} } }));

    expect(describeInheritedClaudeConfiguration(home)).toContain(
      `${join(home, '.claude', 'settings.json')}, 2 user MCP servers, 2 enabled plugins`,
    );
  });

  it('describes an empty native configuration without failing', () => {
    const home = mkdtempSync(join(tmpdir(), 'outfitter-claude-strategy-'));
    roots.push(home);
    expect(describeInheritedClaudeConfiguration(home)).toContain('no user settings file, 0 user MCP servers');
  });

  it('ignores malformed and non-object native configuration values', () => {
    const home = mkdtempSync(join(tmpdir(), 'outfitter-claude-strategy-'));
    roots.push(home);
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), '{not-json');
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: [] }));

    expect(describeInheritedClaudeConfiguration(home)).toContain('0 user MCP servers, 0 enabled plugins');
  });
});
