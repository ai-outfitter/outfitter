// Tests the tool-name invariant at the agent read boundary, including the config.json overlay path
// that agent.schema.json never sees.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isAgentDefinitionIssue, readAgentDefinition } from '../../src/resolver/AgentDefinition.js';

const temporaryRoots: string[] = [];
const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-agent-tools-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agentMd = (name: string, extra = ''): string =>
  `---\nname: ${name}\ndescription: The ${name} agent.\n${extra}---\n\n# ${name}\n\nBody for ${name}.\n`;

const expectIssueContaining = (result: ReturnType<typeof readAgentDefinition>, substring: string): void => {
  expect(isAgentDefinitionIssue(result)).toBe(true);
  if (isAgentDefinitionIssue(result)) {
    expect(result.message).toContain(substring);
  }
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('agent definition tool names', () => {
  it('rejects an unusable tool name injected through a config.json overlay', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer', 'tools:\n  allow: [read]\n'));
    // agent.schema.json only sees the frontmatter, so the overlay is the path that must be checked
    // again: without this the name reaches projection and only fails at run time.
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { allow: ['--dangerously-skip-permissions'] } }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      'unusable tool name "--dangerously-skip-permissions"',
    );
  });

  it('rejects an unusable tool name in a config.json deny list', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { deny: ['read,write'] } }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      'unusable tool name "read,write"',
    );
  });

  it('rejects an unusable tool name in agent.md frontmatter through the schema', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer', 'tools:\n  allow: ["--dangerously-skip-permissions"]\n'));

    expectIssueContaining(readAgentDefinition(join(agentDir, 'agent.md')), 'invalid');
  });

  it('accepts a config.json overlay whose tool names are projectable', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer', 'tools:\n  allow: [read]\n'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { allow: ['read', 'web-search'] } }));

    const parsed = readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]);

    expect(isAgentDefinitionIssue(parsed)).toBe(false);
    if (isAgentDefinitionIssue(parsed)) return;
    expect(parsed.loadout.tools?.allow).toEqual(['read', 'web-search']);
  });
});
