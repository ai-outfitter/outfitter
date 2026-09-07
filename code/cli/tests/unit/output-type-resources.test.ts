import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createListCommand } from '../../src/cli/commands/ListCommand.js';
import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';
import { readOutputTypeSchema, validateOutputValue } from '../../src/validation/SchemaValidator.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-output-type-resources-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const outputTypeSchema = `${JSON.stringify(
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    required: ['number', 'html_url'],
    properties: {
      number: { type: 'integer', minimum: 1 },
      html_url: { type: 'string', format: 'uri' },
    },
  },
  null,
  2,
)}\n`;

const resolvedSet = (home: string, project: string) =>
  resolveResources(discoverLayers({ homeDirectory: home, projectDirectory: project, settings: {} }).layers);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('output type resources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.1.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves output types by slug with workspace-over-global shadowing', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(home, '.agents', 'output-types', 'artifact', 'schema.json'), '{"title":"global"}\n');
    write(join(project, '.agents', 'output-types', 'artifact', 'schema.json'), '{"title":"workspace"}\n');

    const artifact = findResource(resolvedSet(home, project), 'output-type', 'artifact');

    expect(artifact?.winner.layer.origin).toBe('workspace');
    expect(artifact?.shadowed.map((definition) => definition.layer.origin)).toEqual(['global']);
    expect(artifact?.winner.path).toBe(join(project, '.agents', 'output-types', 'artifact', 'schema.json'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.1.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('list output-types --json emits stable catalog provenance', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'output-types', 'issue', 'schema.json'), '{}\n');
    write(join(project, '.agents', 'output-types', 'git-commit', 'schema.json'), '{}\n');
    const lines: string[] = [];
    const program = new Command();
    createListCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      writeLine: (message) => lines.push(message),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'list', 'output-types', '--json']);

    expect(JSON.parse(lines.join('\n'))).toEqual({
      ok: true,
      resources: [
        {
          kind: 'output-type',
          slug: 'git-commit',
          layer: 'workspace',
          path: join(project, '.agents', 'output-types', 'git-commit', 'schema.json'),
          ownerAgent: null,
        },
        {
          kind: 'output-type',
          slug: 'issue',
          layer: 'workspace',
          path: join(project, '.agents', 'output-types', 'issue', 'schema.json'),
          ownerAgent: null,
        },
      ],
      diagnostics: ['output-types:', '  git-commit  [workspace]', '  issue  [workspace]'],
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.4, OFTR-013.3.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects an action output whose type does not resolve', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'workflows', 'root', 'workflow.yaml'),
      `version: 1
id: root
title: Root
description: Publish a deployment.
actors: {}
outputs:
  deployment: {from: deploy, type: organization-deployment}
nodes:
  - {id: deploy, action: deploy, description: Deploy.}
`,
    );

    expect(validateEffectiveSet(resolvedSet(join(root, 'home'), project), project)).toContainEqual({
      severity: 'error',
      resource: 'workflow:root',
      message: "output 'deployment' references unknown output type 'organization-deployment'.",
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.5, OFTR-013.4.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports an invalid output type schema once across referencing workflows', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    for (const slug of ['first', 'second']) {
      write(
        join(catalog, 'workflows', slug, 'workflow.yaml'),
        `version: 1
id: ${slug}
title: ${slug}
description: Publish an issue.
actors: {}
outputs:
  issue: {from: work, type: issue}
nodes:
  - {id: work, action: work, description: Work.}
`,
      );
    }
    write(join(catalog, 'output-types', 'issue', 'schema.json'), '{"type":"not-a-json-schema-type"}\n');

    const findings = validateEffectiveSet(resolvedSet(join(root, 'home'), project), project).filter(
      (finding) => finding.resource === 'output-type:issue' && finding.message.includes('invalid schema'),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain("output type 'issue' has an invalid schema:");

    write(join(catalog, 'settings.yml'), 'workflows:\n  - first\n');
    const out = join(root, 'invalid-dump');
    const dump = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      workflow: 'first',
      out,
    });
    expect(dump.ok).toBe(false);
    expect(dump.messages.join('\n')).toContain("output type 'issue' has an invalid schema:");
    expect(existsSync(join(out, '.agents'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates output values against a schema read from a catalog fixture', () => {
    const root = createTemporaryRoot();
    const path = join(root, 'output-types', 'issue', 'schema.json');
    write(path, outputTypeSchema);
    const result = readOutputTypeSchema(path);
    expect('issue' in result).toBe(false);
    if ('issue' in result) return;

    expect(validateOutputValue(result.schema, { number: 377, html_url: 'https://forge.example/issues/377' })).toEqual({
      valid: true,
      issues: [],
    });
    expect(validateOutputValue(result.schema, {}).valid).toBe(false);
    expect(validateOutputValue(result.schema, { number: 377, html_url: 'not a uri' }).valid).toBe(false);
  });

  it('reports unreadable, malformed, and non-object schema documents', () => {
    const root = createTemporaryRoot();
    const missing = readOutputTypeSchema(join(root, 'missing.json'));
    expect('issue' in missing).toBe(true);
    if ('issue' in missing) expect(missing.issue).toContain('readable');

    const brokenPath = join(root, 'output-types', 'broken', 'schema.json');
    write(brokenPath, '{');
    const broken = readOutputTypeSchema(brokenPath);
    expect('issue' in broken).toBe(true);
    if ('issue' in broken) expect(broken.issue).toContain('valid JSON');

    const arrayPath = join(root, 'output-types', 'array', 'schema.json');
    write(arrayPath, '[]\n');
    expect(readOutputTypeSchema(arrayPath)).toEqual({ issue: 'schema.json must contain a JSON object' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.1.6, OFTR-013.4.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('exports sorted output type sources and copies the winning schemas from the workflow closure', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    const workspaceIssueSchema = outputTypeSchema.replace(
      '"type": "object"',
      '"title": "workspace",\n  "type": "object"',
    );
    const globalIssueSchema = outputTypeSchema.replace('"type": "object"', '"title": "global",\n  "type": "object"');
    write(join(home, '.agents', 'output-types', 'issue', 'schema.json'), globalIssueSchema);
    write(join(catalog, 'output-types', 'issue', 'schema.json'), workspaceIssueSchema);
    write(join(catalog, 'output-types', 'git-commit', 'schema.json'), outputTypeSchema);
    write(
      join(catalog, 'workflows', 'leaf', 'workflow.yaml'),
      `version: 1
id: leaf
title: Leaf
description: Publish an issue.
actors: {}
outputs:
  issue: {from: work, type: issue}
nodes:
  - {id: work, action: work, description: Work.}
`,
    );
    write(
      join(catalog, 'workflows', 'root', 'workflow.yaml'),
      `version: 1
id: root
title: Root
description: Publish a commit and mapped issue.
actors: {}
outputs:
  commit: {from: publish, type: git-commit}
  issue: {from: leaf, output: issue}
nodes:
  - {id: publish, action: publish, description: Publish.}
  - {id: leaf, workflow: leaf, description: Run leaf.}
`,
    );
    write(join(catalog, 'settings.yml'), 'workflows:\n  - root\n');
    const out = join(root, 'dump');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, workflow: 'root', out });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(out, '.agents', 'output-types', 'issue', 'schema.json'), 'utf8')).toBe(
      workspaceIssueSchema,
    );
    expect(readFileSync(join(out, '.agents', 'output-types', 'git-commit', 'schema.json'), 'utf8')).toBe(
      outputTypeSchema,
    );
    const manifest = JSON.parse(
      readFileSync(join(out, '.agents', '.outfitter', 'workflow-composition.json'), 'utf8'),
    ) as {
      outputTypes: readonly { slug: string; source: { layer: string; path: string } }[];
      files: readonly { path: string; sha256: string }[];
    };
    expect(manifest.outputTypes).toEqual([
      {
        slug: 'git-commit',
        source: { layer: 'workspace', path: 'output-types/git-commit/schema.json' },
      },
      { slug: 'issue', source: { layer: 'workspace', path: 'output-types/issue/schema.json' } },
    ]);
    const filePaths = manifest.files.map((file) => file.path);
    expect(filePaths).toContain('output-types/git-commit/schema.json');
    expect(filePaths).toContain('output-types/issue/schema.json');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.6, OFTR-013.4.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('refuses to dump a workflow whose output type is not resolvable', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    write(
      join(catalog, 'workflows', 'root', 'workflow.yaml'),
      `version: 1
id: root
title: Root
description: Publish an unknown value.
actors: {}
outputs:
  unknown: {from: work, type: unknown-value}
nodes:
  - {id: work, action: work, description: Work.}
`,
    );
    write(join(catalog, 'settings.yml'), 'workflows:\n  - root\n');
    const out = join(root, 'dump');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      workflow: 'root',
      out,
    });

    expect(result.ok).toBe(false);
    expect(result.messages).toContain("workflow output type 'unknown-value' is not resolvable.");
    expect(existsSync(join(out, '.agents'))).toBe(false);
  });
});
