// Tests loadout `tools` projection: pi availability flags, claude availability + permission flags,
// deny-only selections on both harnesses, and tool names that would escape into harness argv.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import { TOOL_NAME_PATTERN } from '../../src/projection/Tools.js';
import type { Harness } from '../../src/settings/Settings.js';
import { validateSchema } from '../../src/validation/SchemaValidator.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-tools-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const planWith = (tools: CompositionPlan['loadout']['tools']): CompositionPlan => ({
  agent: 'agent',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
    ...(tools === undefined ? {} : { tools }),
  },
  warnings: [],
});

const project = (
  harness: Harness,
  tools: CompositionPlan['loadout']['tools'],
): ReturnType<typeof projectComposition> => {
  const dir = root();
  return projectComposition(planWith(tools), { harness, rootDirectory: dir, homeDirectory: dir });
};

describe('projectComposition tools', () => {
  it('projects an allowlist to pi availability flags', () => {
    const projection = project('pi', { allow: ['read', 'bash'] });

    // `--no-tools`, not `--no-builtin-tools`: the latter keeps extension and custom tools.
    expect(projection.launch.args.slice(0, 4)).toEqual(['--no-tools', '--tools', 'read,bash', '--system-prompt']);
    expect(projection.launch.args).not.toContain('--no-builtin-tools');
    expect(projection.unsupported).not.toContain('tools');
  });

  it('projects an allowlist to claude availability and permission flags', () => {
    const projection = project('claude', { allow: ['Read', 'Bash'] });

    // `--tools` is the availability ceiling; `--allowedTools` pre-approves the same names within
    // it, so a headless session is not stopped by a prompt for the tools the profile granted.
    // `--allowedTools` alone would fail open: every unlisted builtin would stay available.
    expect(projection.launch.args.slice(0, 6)).toEqual(['--tools', 'Read', 'Bash', '--allowedTools', 'Read', 'Bash']);
    expect(projection.launch.args).not.toContain('--no-builtin-tools');
    expect(projection.unsupported).not.toContain('tools');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.10.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('removes denied tools from the projected allowlist on both harnesses', () => {
    const selection = { allow: ['read', 'bash', 'write'], deny: ['bash'] };

    expect(project('pi', selection).launch.args.slice(0, 5)).toEqual([
      '--no-tools',
      '--tools',
      'read,write',
      '--exclude-tools',
      'bash',
    ]);
    // Claude also states the denial outright: a bare name in --disallowedTools removes the tool
    // from context per the docs, so the exclusion does not rest on the filter alone. The denied
    // name is absent from both the --tools ceiling and the --allowedTools pre-approval.
    expect(project('claude', selection).launch.args.slice(0, 8)).toEqual([
      '--tools',
      'read',
      'write',
      '--allowedTools',
      'read',
      'write',
      '--disallowedTools',
      'bash',
    ]);
  });

  it('projects a deny-only selection to claude --disallowedTools', () => {
    const projection = project('claude', { deny: ['Bash', 'Write'] });

    expect(projection.launch.args.slice(0, 3)).toEqual(['--disallowedTools', 'Bash', 'Write']);
    // No allowlist was declared, so no availability ceiling is imposed on the rest.
    expect(projection.launch.args).not.toContain('--tools');
    expect(projection.launch.args).not.toContain('--allowedTools');
    expect(projection.unsupported).not.toContain('tools');
  });

  it('projects a deny-only selection to pi --exclude-tools without capping the rest', () => {
    const projection = project('pi', { deny: ['bash', 'write'] });

    // No allowlist was declared, so no ceiling is imposed: only the named tools are removed.
    expect(projection.launch.args.slice(0, 2)).toEqual(['--exclude-tools', 'bash,write']);
    expect(projection.launch.args).not.toContain('--no-tools');
    expect(projection.launch.args).not.toContain('--tools');
    expect(projection.unsupported).not.toContain('tools');
  });

  it('empties the session on both harnesses when deny empties the allowlist', () => {
    const selection = { allow: ['bash'], deny: ['bash'] };
    const pi = project('pi', selection);
    const claude = project('claude', selection);

    // `--no-builtin-tools` would leave every extension-registered tool in the session, so the
    // "zero tools" request must project to `--no-tools`.
    expect(pi.launch.args.slice(0, 3)).toEqual(['--no-tools', '--exclude-tools', 'bash']);
    expect(pi.launch.args).not.toContain('--tools');
    expect(pi.launch.args).not.toContain('--no-builtin-tools');
    expect(pi.unsupported).not.toContain('tools');
    // Claude's documented "disable all tools" form is `--tools ""` — one empty-string argv
    // element. Emitting only --disallowedTools here would fail open: every non-denied builtin
    // would stay available though the profile requested zero. There is nothing left to
    // pre-approve, so --allowedTools is absent. MCP tools from selected servers survive
    // `--tools ""` per the CLI reference, so this is still not exactly pi's zero-tool session.
    expect(claude.launch.args.slice(0, 4)).toEqual(['--tools', '', '--disallowedTools', 'bash']);
    expect(claude.launch.args).not.toContain('--allowedTools');
    expect(claude.unsupported).not.toContain('tools');
  });

  it('adds no tool flags when a selection declares neither allow nor deny', () => {
    for (const harness of ['pi', 'claude'] as const) {
      const projection = project(harness, {});

      expect(projection.launch.args).not.toContain('--tools');
      expect(projection.launch.args).not.toContain('--allowedTools');
      expect(projection.launch.args).not.toContain('--disallowedTools');
      expect(projection.launch.args).not.toContain('--no-tools');
      expect(projection.launch.args).not.toContain('--exclude-tools');
      expect(projection.unsupported).not.toContain('tools');
    }
  });

  it('adds no tool flags and reports nothing unsupported when tools is absent', () => {
    for (const harness of ['pi', 'claude'] as const) {
      const projection = project(harness, undefined);

      expect(projection.launch.args).not.toContain('--no-tools');
      expect(projection.launch.args).not.toContain('--allowedTools');
      expect(projection.unsupported).not.toContain('tools');
    }
  });
});

const agentDocumentWithTools = (tools: Record<string, readonly string[]>): Record<string, unknown> => ({
  name: 'lead',
  tools,
});

describe('tool name validation', () => {
  it('throws instead of projecting a tool name that would become a harness flag', () => {
    for (const harness of ['pi', 'claude'] as const) {
      expect(() => project(harness, { allow: ['Read', '--dangerously-skip-permissions'] })).toThrow(
        /--dangerously-skip-permissions.*cannot be projected/,
      );
    }
  });

  it('throws instead of projecting a tool name containing a comma or whitespace', () => {
    expect(() => project('pi', { allow: ['read,write'] })).toThrow(/"read,write" cannot be projected/);
    expect(() => project('claude', { allow: ['Bash(npm run test)'] })).toThrow(/cannot be projected/);
  });

  it('rejects a poisoned deny entry, and rejects one that deny filtering would have removed', () => {
    expect(() => project('claude', { deny: ['--dangerously-skip-permissions'] })).toThrow(/cannot be projected/);
    // The name is filtered out of the allowlist, and must still be rejected rather than ignored.
    expect(() => project('pi', { allow: ['-x'], deny: ['-x'] })).toThrow(/"-x" cannot be projected/);
  });

  it('rejects the same names at the agent schema read boundary', () => {
    for (const name of ['--dangerously-skip-permissions', '-x', 'read,write', 'npm run test']) {
      expect(validateSchema('agent', agentDocumentWithTools({ allow: [name] })).valid).toBe(false);
      expect(validateSchema('agent', agentDocumentWithTools({ deny: [name] })).valid).toBe(false);
    }
    expect(validateSchema('agent', agentDocumentWithTools({ allow: ['read', 'web-search'] })).valid).toBe(true);
  });

  it('keeps the schema pattern and the projection pattern identical', () => {
    const schema = JSON.parse(
      readFileSync(new URL('../../src/schemas/agent.schema.json', import.meta.url), 'utf8'),
    ) as { readonly $defs: { readonly toolName: { readonly pattern: string } } };

    expect(schema.$defs.toolName.pattern).toBe(TOOL_NAME_PATTERN.source);
  });
});
