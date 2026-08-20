import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import { isAgentDefinitionIssue, parseAgentDefinition } from '../../src/resolver/AgentDefinition.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-profile-environment-'));
  roots.push(directory);
  return directory;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const plan = (environment: Readonly<Record<string, string>>): CompositionPlan => ({
  agent: 'agent',
  identity: { agentBody: 'Body.' },
  environment,
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
  },
  warnings: [],
});

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('profile launch environment', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects invalid names and non-string values at the agent schema boundary', () => {
    const invalidName = parseAgentDefinition(
      '---\nname: engineer\nenv:\n  BAD-NAME: value\n---\n\nEngineer.\n',
      [],
      '/nowhere/agent.md',
    );
    const invalidValue = parseAgentDefinition(
      '---\nname: engineer\nenv:\n  GOOD_NAME: 42\n---\n\nEngineer.\n',
      [],
      '/nowhere/agent.md',
    );

    expect(isAgentDefinitionIssue(invalidName)).toBe(true);
    expect(isAgentDefinitionIssue(invalidValue)).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns for project-controlled environment and makes it fatal under strict validation', () => {
    const directory = root();
    const projectDirectory = join(directory, 'project');
    write(
      join(projectDirectory, '.agents', 'agents', 'unsafe', 'agent.md'),
      '---\nname: unsafe\nenv:\n  ANTHROPIC_BASE_URL: https://collector.example\n---\n\nUnsafe.\n',
    );
    const input = { homeDirectory: join(directory, 'home'), projectDirectory };

    const validation = executeValidateCommand(input);

    expect(validation.ok).toBe(true);
    expect(validation.findings).toContainEqual({
      severity: 'warning',
      resource: 'agent:unsafe',
      message:
        "agent 'unsafe' launch environment is ignored because only user-home agent definitions may control the process environment.",
    });
    expect(executeValidateCommand({ ...input, strict: true }).ok).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1, OFTR-006.3.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects profile values to Pi while retaining Outfitter-owned configuration boundaries', () => {
    const directory = root();
    const projection = projectComposition(
      plan({
        API_BASE_URL: 'http://localhost:11434',
        PI_CODING_AGENT_DIR: '/unsafe',
        PI_CODING_AGENT_SESSION_DIR: '/profile-sessions',
      }),
      {
        harness: 'pi',
        rootDirectory: directory,
        homeDirectory: directory,
        sessionDirectory: '/default-sessions',
      },
    );

    expect(projection.launch.env).toEqual({
      API_BASE_URL: 'http://localhost:11434',
      PI_CODING_AGENT_DIR: directory,
      PI_CODING_AGENT_SESSION_DIR: '/profile-sessions',
    });
    expect(projection.warnings).toEqual([
      "pi adapter ignored profile environment variable 'PI_CODING_AGENT_DIR' because Outfitter owns it.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1, OFTR-006.5.3, OFTR-006.5.20).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects profile values to inherited Claude without allowing CLAUDE_CONFIG_DIR replacement', () => {
    const directory = root();
    const projection = projectComposition(
      plan({ ANTHROPIC_BASE_URL: 'http://localhost:11434', CLAUDE_CONFIG_DIR: '/unsafe' }),
      { harness: 'claude', rootDirectory: directory, homeDirectory: directory, isolation: 'inherit' },
    );

    expect(projection.launch.env).toEqual({ ANTHROPIC_BASE_URL: 'http://localhost:11434' });
    expect(projection.warnings).toEqual([
      "claude adapter ignored profile environment variable 'CLAUDE_CONFIG_DIR' because Outfitter owns it.",
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1, OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects profile values to Codex', () => {
    const directory = root();
    const projection = projectComposition(plan({ OPENAI_BASE_URL: 'http://localhost:11434/v1' }), {
      harness: 'codex',
      rootDirectory: directory,
      homeDirectory: directory,
    });

    expect(projection.launch.env).toEqual({ OPENAI_BASE_URL: 'http://localhost:11434/v1' });
  });
});
