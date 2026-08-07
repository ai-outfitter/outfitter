// Tests the tool-name and raw-shape invariants at the agent read boundary, including the
// config.json overlay path that agent.schema.json never sees.
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

  // Silent normalization of a malformed `tools` value fails open: the selection collapses to
  // empty or partial and the agent launches WITHOUT the restriction the author wrote, `--strict`
  // included. Each malformed shape must be a hard error naming the defect.
  it('rejects a config.json tools object with an unknown key instead of dropping the selection', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { allowed: ['bash'] } }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      'unknown key "allowed"',
    );
  });

  it('rejects a config.json tools.allow that is a string instead of an array', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { allow: 'read' } }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      '`tools.allow` must be an array of tool names, not a string',
    );
  });

  it('rejects a non-string entry in a config.json tools list', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { deny: ['bash', 7] } }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      '`tools.deny[1]` must be a non-empty string, not 7',
    );
  });

  it('rejects an empty-string entry in a config.json tools list', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { allow: [''] } }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      '`tools.allow[0]` must be a non-empty string',
    );
  });

  it('rejects a config.json tools value of null without crashing', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: null }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      '`tools` must be an object of the form {allow?: [...], deny?: [...]}, not null',
    );
  });

  it('rejects a config.json tools value that is an array instead of an object', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: ['bash'] }));

    expectIssueContaining(
      readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]),
      'not an array',
    );
  });

  it('preserves key presence: a deny-only selection does not grow an empty allowlist', () => {
    const agentDir = join(createTemporaryRoot(), 'agents', 'engineer');
    write(join(agentDir, 'agent.md'), agentMd('engineer'));
    // An absent `allow` must stay absent. Normalizing it to [] would fabricate a declared-empty
    // allowlist, which projects an availability ceiling the author never asked for.
    write(join(agentDir, 'config.json'), JSON.stringify({ tools: { deny: ['bash'] } }));

    const parsed = readAgentDefinition(join(agentDir, 'agent.md'), [join(agentDir, 'config.json')]);

    expect(isAgentDefinitionIssue(parsed)).toBe(false);
    if (isAgentDefinitionIssue(parsed)) return;
    expect(parsed.loadout.tools).toEqual({ deny: ['bash'] });
    expect(parsed.loadout.tools).not.toHaveProperty('allow');
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
