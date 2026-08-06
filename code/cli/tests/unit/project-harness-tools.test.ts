// Tests loadout `tools` projection: pi availability flags, claude permission flags, and the
// deny-only-on-pi case that stays unsupported.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { Harness } from '../../src/settings/Settings.js';

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

    expect(projection.launch.args.slice(0, 4)).toEqual([
      '--no-builtin-tools',
      '--tools',
      'read,bash',
      '--system-prompt',
    ]);
    expect(projection.unsupported).not.toContain('tools');
  });

  it('projects an allowlist to claude permission flags', () => {
    const projection = project('claude', { allow: ['Read', 'Bash'] });

    expect(projection.launch.args.slice(0, 3)).toEqual(['--allowedTools', 'Read', 'Bash']);
    expect(projection.launch.args).not.toContain('--no-builtin-tools');
    expect(projection.unsupported).not.toContain('tools');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.10.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('removes denied tools from the projected allowlist on both harnesses', () => {
    const selection = { allow: ['read', 'bash', 'write'], deny: ['bash'] };

    expect(project('pi', selection).launch.args.slice(0, 3)).toEqual(['--no-builtin-tools', '--tools', 'read,write']);
    // Claude also states the denial outright: absence from --allowedTools only means "needs
    // approval", so filtering alone would leave the exclusion resting on the prompt path.
    expect(project('claude', selection).launch.args.slice(0, 5)).toEqual([
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
    expect(projection.unsupported).not.toContain('tools');
  });

  it('reports a deny-only selection unsupported on pi and adds no tool flags', () => {
    const projection = project('pi', { deny: ['bash'] });

    expect(projection.launch.args).not.toContain('--no-builtin-tools');
    expect(projection.launch.args).not.toContain('--tools');
    expect(projection.unsupported).toContain('tools');
  });

  it('keeps --no-builtin-tools when deny empties the allowlist, and leaves claude with only denies', () => {
    const selection = { allow: ['bash'], deny: ['bash'] };
    const pi = project('pi', selection);
    const claude = project('claude', selection);

    expect(pi.launch.args[0]).toBe('--no-builtin-tools');
    expect(pi.launch.args).not.toContain('--tools');
    expect(pi.unsupported).not.toContain('tools');
    // Claude has no "deny everything" form, so an emptied allowlist survives only as the explicit
    // denies. This is not equivalent to pi's zero-tool session.
    expect(claude.launch.args).not.toContain('--allowedTools');
    expect(claude.launch.args.slice(0, 2)).toEqual(['--disallowedTools', 'bash']);
    expect(claude.unsupported).not.toContain('tools');
  });

  it('adds no tool flags when a selection declares neither allow nor deny', () => {
    const projection = project('claude', {});

    expect(projection.launch.args).not.toContain('--allowedTools');
    expect(projection.launch.args).not.toContain('--disallowedTools');
    expect(projection.unsupported).not.toContain('tools');
  });

  it('adds no tool flags and reports nothing unsupported when tools is absent', () => {
    for (const harness of ['pi', 'claude'] as const) {
      const projection = project(harness, undefined);

      expect(projection.launch.args).not.toContain('--no-builtin-tools');
      expect(projection.launch.args).not.toContain('--allowedTools');
      expect(projection.unsupported).not.toContain('tools');
    }
  });
});
