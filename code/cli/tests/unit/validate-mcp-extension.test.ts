import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createValidateCommand, executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';

const roots: string[] = [];
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const fixture = (loadout: string): { homeDirectory: string; projectDirectory: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-validate-mcp-'));
  roots.push(root);
  const projectDirectory = join(root, 'project');
  write(
    join(projectDirectory, '.agents', 'agents', 'resident', 'agent.md'),
    `---\nname: resident\n${loadout}---\n\nResident.\n`,
  );
  write(
    join(projectDirectory, '.agents', 'mcp.json'),
    `${JSON.stringify({ mcpServers: { github: { command: 'github-mcp-server' } } }, null, 2)}\n`,
  );
  return { homeDirectory: join(root, 'home'), projectDirectory };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Pi MCP adapter validation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns for selected MCP servers without pi-mcp-adapter and fails under strict mode', () => {
    const input = fixture('mcp: [github]\n');
    const result = executeValidateCommand({ ...input, harness: 'pi' });

    expect(result.ok).toBe(true);
    expect(result.findings).toContainEqual({
      severity: 'warning',
      resource: 'agent:resident',
      message:
        "MCP servers are selected for Pi, but no MCP-capable extension is configured; add 'npm:pi-mcp-adapter' to extensions.",
    });
    expect(executeValidateCommand({ ...input, harness: 'pi', strict: true }).ok).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts the canonical MCP adapter, including a versioned package specifier', () => {
    const unversioned = fixture('mcp: [github]\nextensions: [npm:pi-mcp-adapter]\n');
    const versioned = fixture('mcp: [github]\nextensions: [npm:pi-mcp-adapter@1.2.3]\n');

    expect(executeValidateCommand({ ...unversioned, harness: 'pi', strict: true }).ok).toBe(true);
    expect(executeValidateCommand({ ...versioned, harness: 'pi', strict: true }).ok).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not warn without an MCP selection or when targeting another harness', () => {
    const noMcp = fixture('');
    const claude = fixture('mcp: [github]\n');

    expect(executeValidateCommand({ ...noMcp, harness: 'pi', strict: true }).ok).toBe(true);
    expect(executeValidateCommand({ ...claude, harness: 'claude', strict: true }).ok).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('wires the --harness target through the validate command', async () => {
    const input = fixture('mcp: [github]\n');
    const lines: string[] = [];
    const program = new Command();
    createValidateCommand({ ...input, writeLine: (line) => lines.push(line) }).register(program);

    await program.parseAsync(['node', 'outfitter', 'validate', '--harness', 'pi']);

    expect(lines.join('\n')).toContain("add 'npm:pi-mcp-adapter' to extensions");
  });
});
