// Tests the harness-neutral `.agents` validation gate shared by validate and run --strict.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';
import { setupNextStepMessage } from '../../src/setup/Setup.js';

const temporaryRoots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-common-validation-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const skill = (name: string, description: string): string =>
  `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${name}\n`;

const agent = (name: string): string => `---\nname: ${name}\n---\n\n# ${name}\n`;

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('common .agents validation', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.1-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('checks every global and agent-local skill, including unused skills', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer'));
    write(join(project, '.agents', 'skills', 'missing', 'SKILL.md'), '---\nname: missing\n---\n');
    write(join(project, '.agents', 'skills', 'empty', 'SKILL.md'), skill('empty', ''));
    write(join(project, '.agents', 'skills', 'long', 'SKILL.md'), skill('long', 'x'.repeat(1025)));
    write(join(project, '.agents', 'agents', 'engineer', 'skills', 'private', 'SKILL.md'), 'not frontmatter');

    const result = executeValidateCommand({ homeDirectory: join(root, 'home'), projectDirectory: project });
    const byResource = new Map(result.findings.map((finding) => [finding.resource, finding]));

    expect(byResource.get('skill:missing')?.code).toBe('missing-description');
    expect(byResource.get('skill:empty')?.code).toBe('missing-description');
    expect(byResource.get('skill:long')?.code).toBe('description-too-long');
    expect(byResource.get('agent:engineer/skill:private')?.code).toBe('invalid-frontmatter');
    expect(result.ok).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns only for a clearly non-actionable description', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'generic', 'SKILL.md'), skill('generic', 'A generic skill.'));
    write(
      join(project, '.agents', 'skills', 'actionable', 'SKILL.md'),
      skill('actionable', 'Review pull requests. Use when a change needs correctness and safety checks.'),
    );

    const findings = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
    }).findings;

    expect(findings.filter((finding) => finding.code === 'description-not-actionable')).toEqual([
      expect.objectContaining({ resource: 'skill:generic', severity: 'warning' }),
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.7-003.12.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('returns stable JSON fields and gives run --strict the same findings before harness selection', async () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer'));
    write(join(project, '.agents', 'skills', 'unused', 'SKILL.md'), '---\nname: unused\n---\n');
    let launched = false;

    const validation = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      json: true,
    });
    const run = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      harness: 'not-a-harness',
      strict: true,
      appendPromptPaths: [join(root, 'absent.md')],
      launcher: () => {
        launched = true;
        return Promise.resolve(0);
      },
    });

    expect(run.commonFindings).toEqual(validation.findings);
    expect(run.exitCode).toBe(1);
    expect(launched).toBe(false);
    const json = JSON.parse(validation.messages[0]) as { readonly ok: boolean; readonly findings: readonly unknown[] };
    expect(json.ok).toBe(false);
    expect(json.findings).toEqual(validation.findings);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not apply the complete common gate to a normal run', async () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer'));
    write(join(project, '.agents', 'skills', 'unused', 'SKILL.md'), 'not frontmatter');
    let launched = false;

    const result = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher: () => {
        launched = true;
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
    expect(launched).toBe(true);
    expect(result.commonFindings).toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.2-003.12.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('stops an invalid initial tree before first-run setup or launch', async () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'skills', 'unused', 'SKILL.md'), '---\nname: unused\n---\n');
    let setupCalls = 0;
    let launchCalls = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      strict: true,
      setup: () => {
        setupCalls += 1;
        return Promise.resolve({
          created: [],
          updated: [],
          settingsPath: join(project, '.agents', 'settings.yml'),
          defaultAgent: 'engineer',
          defaultHarness: 'pi',
          messages: [],
        });
      },
      launcher: () => {
        launchCalls += 1;
        return Promise.resolve(0);
      },
    });

    expect(result.commonFindings?.map((finding) => finding.code)).toContain('missing-description');
    expect(setupCalls).toBe(0);
    expect(launchCalls).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('revalidates a clean strict tree after setup does not select an agent', async () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    let setupCalls = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      strict: true,
      setup: () => {
        setupCalls += 1;
        return Promise.resolve({
          created: [],
          updated: [],
          settingsPath: join(project, '.agents', 'settings.yml'),
          defaultHarness: 'pi',
          messages: [],
        });
      },
      launcher: () => Promise.reject(new Error('launcher must not run')),
    });

    expect(setupCalls).toBe(1);
    expect(result.exitCode).toBe(0);
    expect(result.messages).toContain(setupNextStepMessage);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.1-003.12.3, OFTR-003.12.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('collects ambiguity and invalid unused skills identically for validate and strict run', async () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const first = join(root, 'first');
    const second = join(root, 'second');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), agent('engineer'));
    write(join(first, 'skills', 'shared', 'SKILL.md'), '---\nname: shared\n---\n');
    write(
      join(first, 'agents', 'engineer', 'skills', 'private', 'SKILL.md'),
      skill('private', 'Check private resources. Use when validating local source precedence.'),
    );
    write(
      join(second, 'skills', 'shared', 'SKILL.md'),
      skill('shared', 'Review shared resources. Use when checking source precedence.'),
    );
    write(
      join(second, 'agents', 'engineer', 'skills', 'private', 'SKILL.md'),
      skill('private', 'Check private resources. Use when validating local source precedence.'),
    );
    write(join(project, '.agents', 'settings.yml'), `sources:\n  - path: ${first}\n  - path: ${second}\n`);
    const input = { homeDirectory: join(root, 'home'), projectDirectory: project };

    const validation = executeValidateCommand(input);
    const run = await executeRunAgentCommand({
      ...input,
      agent: 'engineer',
      strict: true,
      launcher: () => Promise.resolve(0),
    });

    expect(run.commonFindings).toEqual(validation.findings);
    expect(run.commonFindings?.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['settings-warning', 'missing-description', 'resource-shadowed']),
    );
    expect(run.commonFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'settings-warning',
          resource: 'skill:shared',
          sourcePath: join(first, 'skills', 'shared', 'SKILL.md'),
        }),
        expect.objectContaining({
          code: 'settings-warning',
          resource: 'agent:engineer/skill:private',
          sourcePath: join(first, 'agents', 'engineer', 'skills', 'private', 'SKILL.md'),
        }),
      ]),
    );
    expect(run.messages.at(-1)).toContain('ambiguous resolution is fatal');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports escaped references, destination collisions, and shadowed skills with stable codes', () => {
    const root = temporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(
      join(home, '.agents', 'skills', 'shadowed', 'SKILL.md'),
      skill('shadowed', 'Review code. Use when checking changes.'),
    );
    write(
      join(project, '.agents', 'skills', 'shadowed', 'SKILL.md'),
      skill('shadowed', 'Review code. Use when checking changes.'),
    );
    write(join(project, '.agents', 'docs', 'one', 'guide.md'), '# one\n');
    write(join(project, '.agents', 'docs', 'two', 'guide.md'), '# two\n');
    write(
      join(project, '.agents', 'skills', 'references', 'SKILL.md'),
      `---\nname: references\ndescription: Check references. Use when validating skill packages.\nreferences:\n  - file: ../outside.md\n  - file: docs/one/guide.md\n  - file: docs/two/guide.md\n---\n`,
    );

    const findings = executeValidateCommand({ homeDirectory: home, projectDirectory: project }).findings;
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['reference-escaped', 'path-collision', 'resource-shadowed']),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('checks required, optional, glob, and packaged reference targets without harness policy', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const agentsRoot = join(project, '.agents');
    write(join(agentsRoot, 'docs', 'guide.md'), '# guide\n');
    write(join(agentsRoot, 'docs', 'glob-one', 'shared.md'), '# one\n');
    write(join(agentsRoot, 'docs', 'glob-two', 'shared.md'), '# two\n');
    write(join(project, 'docs', 'repo.md'), '# repository guide\n');
    const outside = join(root, 'outside.md');
    write(outside, '# outside\n');
    symlinkSync(outside, join(agentsRoot, 'docs', 'escape.md'));
    write(join(agentsRoot, 'skills', 'references', 'references', 'guide.md'), '# packaged guide\n');
    write(
      join(agentsRoot, 'skills', 'references', 'SKILL.md'),
      `---
name: references
description: Check skill references. Use when validating portable package inputs.
references:
  - file: docs/missing.md
  - file: docs/none/*.md
  - file: docs/*.md
  - file: docs/glob-*/shared.md
  - file: docs/escape*.md
  - file: docs/guide.md
  - repo_file: docs/repo.md
  - repo_file: docs/optional.md
---
`,
    );
    write(
      join(agentsRoot, 'skills', 'malformed-reference', 'SKILL.md'),
      `---
name: malformed-reference
description: Check invalid inputs. Use when testing parser diagnostics.
references: wrong
---
`,
    );

    const findings = executeValidateCommand({ homeDirectory: join(root, 'home'), projectDirectory: project }).findings;
    expect(findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['reference-missing', 'reference-escaped', 'path-collision', 'resource-invalid']),
    );
    expect(findings.some((finding) => finding.message.includes('docs/optional.md'))).toBe(false);

    const set = resolveResources(
      discoverLayers({ homeDirectory: join(root, 'home'), projectDirectory: project, settings: {} }).layers,
    );
    expect(() => validateEffectiveSet(set)).not.toThrow();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('classifies a missing reference below an aliased layer root as missing', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const realAgentsRoot = join(root, 'real-agents');
    mkdirSync(project, { recursive: true });
    symlinkSync(realAgentsRoot, join(project, '.agents'), 'dir');
    write(
      join(realAgentsRoot, 'skills', 'aliased-root', 'SKILL.md'),
      `---
name: aliased-root
description: Check missing references. Use when a catalog root has a filesystem alias.
references:
  - file: docs/missing.md
---
`,
    );

    const findings = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
    }).findings;

    expect(findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'reference-missing', resource: 'skill:aliased-root' })]),
    );
    expect(
      findings.some((finding) => finding.code === 'reference-escaped' && finding.resource === 'skill:aliased-root'),
    ).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts an in-tree reference whose first segment starts with two dots', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', '..catalog', 'guide.md'), '# guide\n');
    write(
      join(project, '.agents', 'skills', 'dot-prefix', 'SKILL.md'),
      `---
name: dot-prefix
description: Check dot-prefixed directories. Use when validating reference containment.
references:
  - file: ..catalog/guide.md
---
`,
    );

    const findings = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
    }).findings;

    expect(
      findings.some((finding) => finding.resource === 'skill:dot-prefix' && finding.code.startsWith('reference-')),
    ).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5, OFTR-003.12.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses structured invalid-name codes and the actual malformed config path', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const configPath = join(project, '.agents', 'agents', 'configured', 'config.json');
    write(join(project, '.agents', 'agents', 'bad-agent', 'agent.md'), agent('Bad Agent'));
    write(join(project, '.agents', 'agents', 'configured', 'agent.md'), agent('configured'));
    write(configPath, '{ invalid json');
    write(
      join(project, '.agents', 'skills', 'bad-skill', 'SKILL.md'),
      skill('Bad Skill', 'Review names. Use when validating resource identifiers.'),
    );

    const findings = executeValidateCommand({ homeDirectory: join(root, 'home'), projectDirectory: project }).findings;
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid-name', resource: 'agent:bad-agent' }),
        expect.objectContaining({ code: 'invalid-name', resource: 'skill:bad-skill' }),
        expect.objectContaining({ resource: 'agent:configured', sourcePath: configPath }),
      ]),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects a referenced directory with a nested symlink that escapes its root', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const agentsRoot = join(project, '.agents');
    const referenceDirectory = join(agentsRoot, 'docs', 'tree');
    write(join(referenceDirectory, 'safe.md'), '# safe\n');
    const outside = join(root, 'outside.md');
    write(outside, '# outside\n');
    symlinkSync(outside, join(referenceDirectory, 'nested-link.md'));
    write(
      join(agentsRoot, 'skills', 'directory-reference', 'SKILL.md'),
      `---
name: directory-reference
description: Inspect documentation trees. Use when validating recursive reference containment.
references:
  - file: docs/tree
---
`,
    );

    const findings = executeValidateCommand({ homeDirectory: join(root, 'home'), projectDirectory: project }).findings;
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'reference-escaped', resource: 'skill:directory-reference' }),
      ]),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5, OFTR-003.12.7-003.12.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a dangling nested symlink without throwing and keeps strict findings equal', async () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const agentsRoot = join(project, '.agents');
    const referenceDirectory = join(agentsRoot, 'docs', 'tree');
    const danglingLink = join(referenceDirectory, 'dangling.md');
    write(join(referenceDirectory, 'safe.md'), '# safe\n');
    symlinkSync(join(referenceDirectory, 'missing.md'), danglingLink);
    write(join(agentsRoot, 'agents', 'engineer', 'agent.md'), agent('engineer'));
    write(
      join(agentsRoot, 'skills', 'directory-reference', 'SKILL.md'),
      `---
name: directory-reference
description: Inspect documentation trees. Use when validating recursive reference failures.
references:
  - file: docs/tree
---
`,
    );

    const validation = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
    });
    const run = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      strict: true,
      launcher: () => Promise.resolve(0),
    });

    const danglingFinding = validation.findings.find(
      (finding) => finding.code === 'reference-missing' && finding.resource === 'skill:directory-reference',
    );
    expect(danglingFinding?.message).toContain(danglingLink);
    expect(run.commonFindings).toEqual(validation.findings);
    expect(run.exitCode).toBe(1);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('deduplicates one target selected by a literal and an overlapping glob', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const agentsRoot = join(project, '.agents');
    write(join(agentsRoot, 'dedupe', 'unique.md'), '# unique\n');
    write(
      join(agentsRoot, 'skills', 'deduplicated-reference', 'SKILL.md'),
      `---
name: deduplicated-reference
description: Select reference files. Use when literal paths and globs can overlap.
references:
  - file: dedupe/unique.md
  - file: dedupe/*.md
---
`,
    );

    const findings = executeValidateCommand({ homeDirectory: join(root, 'home'), projectDirectory: project }).findings;
    expect(
      findings.some(
        (finding) => finding.resource === 'skill:deduplicated-reference' && finding.code === 'path-collision',
      ),
    ).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates overlapping directory matches without duplicate failures', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const agentsRoot = join(project, '.agents');
    write(join(agentsRoot, 'docs', 'tree', 'nested', 'guide.md'), '# guide\n');
    write(
      join(agentsRoot, 'skills', 'overlapping-directories', 'SKILL.md'),
      `---
name: overlapping-directories
description: Inspect documentation trees. Use when directory reference patterns overlap.
references:
  - file: docs/tree
  - file: docs/tree/*
---
`,
    );

    const findings = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
    }).findings;

    expect(findings.filter((finding) => finding.resource === 'skill:overlapping-directories')).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a typed finding when a referenced descendant cannot be inspected', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const agentsRoot = join(project, '.agents');
    write(join(agentsRoot, 'docs', 'tree', 'guide.md'), '# guide\n');
    symlinkSync('loop', join(agentsRoot, 'docs', 'tree', 'loop'));
    write(
      join(agentsRoot, 'skills', 'uninspectable', 'SKILL.md'),
      skill('uninspectable', 'Inspect references. Use when reference trees contain invalid entries.').replace(
        '---\n\n#',
        'references:\n  - file: docs/tree\n---\n\n#',
      ),
    );

    const findings = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
    }).findings;

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'resource-invalid',
          resource: 'skill:uninspectable',
        }),
      ]),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.12.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves the malformed settings.local.yml path in JSON findings', () => {
    const root = temporaryRoot();
    const project = join(root, 'project');
    const settingsPath = join(project, '.agents', 'settings.local.yml');
    write(settingsPath, 'default_harness: invalid\n');

    const result = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      json: true,
    });
    const parsed = JSON.parse(result.messages[0]) as { readonly findings: readonly { readonly sourcePath: string }[] };

    expect(parsed.findings).toEqual(expect.arrayContaining([expect.objectContaining({ sourcePath: settingsPath })]));
  });
});
