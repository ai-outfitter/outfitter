import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createListCommand, executeListCommand } from '../../src/cli/commands/ListCommand.js';
import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';
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

const writeRootWorkflow = (catalog: string, type = 'issue'): void => {
  write(join(catalog, 'settings.yml'), 'workflows:\n  - root\n');
  write(
    join(catalog, 'workflows', 'root', 'workflow.yaml'),
    `version: 1
id: root
title: Root
description: Publish an output.
actors: {}
outputs:
  result: {from: work, type: ${type}}
nodes:
  - {id: work, action: work, description: Work.}
`,
  );
};

const schemaId = (slug: string): string => `https://schemas.example.test/output-types/${slug}`;

const outputTypeSchemaFor = (slug: string): string =>
  `${JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: schemaId(slug),
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

const outputTypeSchema = outputTypeSchemaFor('issue');

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
    write(
      join(home, '.agents', 'output-types', 'artifact', 'schema.json'),
      JSON.stringify({ $id: schemaId('global-artifact'), title: 'global' }),
    );
    write(
      join(project, '.agents', 'output-types', 'artifact', 'schema.json'),
      JSON.stringify({ $id: schemaId('workspace-artifact'), title: 'workspace' }),
    );

    const artifact = findResource(resolvedSet(home, project), 'output-type', 'artifact');

    expect(artifact?.winner.layer.origin).toBe('workspace');
    expect(artifact?.shadowed.map((definition) => definition.layer.origin)).toEqual(['global']);
    expect(artifact?.winner.path).toBe(join(project, '.agents', 'output-types', 'artifact', 'schema.json'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.4.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('list output-types --json emits stable catalog provenance', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'output-types', 'issue', 'schema.json'), outputTypeSchemaFor('issue'));
    write(join(project, '.agents', 'output-types', 'git-commit', 'schema.json'), outputTypeSchemaFor('git-commit'));
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

  it('omits workflow schema ids for output types with schema issues', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    writeRootWorkflow(catalog);
    write(
      join(catalog, 'output-types', 'issue', 'schema.json'),
      `${JSON.stringify({ $id: schemaId('issue'), type: 'not-a-json-schema-type' })}\n`,
    );

    const result = executeListCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      kind: 'workflows',
    });

    expect(result.resources).toEqual([expect.objectContaining({ slug: 'root', outputs: {} })]);
  });

  it('warns when listing drops an output without a resolvable output-type identity', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    writeRootWorkflow(catalog);
    write(join(catalog, 'output-types', 'issue', 'schema.json'), '{"type":"object"}\n');

    const result = executeListCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      kind: 'workflows',
    });

    expect(result.messages).toContain(
      "warning: workflow 'root' output 'result' has no resolvable output-type identity.",
    );
  });

  it('warns when listing drops a mapped output whose nested workflow does not resolve', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    write(join(catalog, 'settings.yml'), 'workflows:\n  - root\n');
    write(
      join(catalog, 'workflows', 'root', 'workflow.yaml'),
      `version: 1
id: root
title: Root
description: Map a missing workflow output.
actors: {}
outputs:
  result: {from: nested, output: value}
nodes:
  - {id: nested, workflow: missing, description: Run the missing workflow.}
`,
    );

    const result = executeListCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      kind: 'workflows',
    });

    expect(result.resources).toEqual([expect.objectContaining({ slug: 'root', outputs: {} })]);
    expect(result.messages).toContain(
      "warning: workflow 'root' output 'result' has no resolvable output-type identity.",
    );
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.9, OFTR-013.4.5).
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
    write(
      join(catalog, 'output-types', 'issue', 'schema.json'),
      JSON.stringify({ $id: schemaId('issue'), $ref: 'https://example.invalid/missing' }),
    );

    const findings = validateEffectiveSet(resolvedSet(join(root, 'home'), project), project).filter(
      (finding) => finding.resource === 'output-type:issue' && finding.message.includes('invalid schema'),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('error');
    expect(findings[0]?.message).toContain("output type 'issue' has an invalid schema:");
    expect(findings[0]?.message).toContain("can't resolve reference https://example.invalid/missing");

    const schemaResult = readOutputTypeSchema(join(catalog, 'output-types', 'issue', 'schema.json'));
    expect(schemaResult.issues).toHaveLength(1);
    expect(schemaResult.issues[0]?.kind).toBe('schema');
    expect(schemaResult.issues[0]?.message).toContain("can't resolve reference https://example.invalid/missing");
    expect(schemaResult.schema).toBeDefined();
    const validation = validateOutputValue(schemaResult.schema!, {});
    expect(validation.valid).toBe(false);
    expect(validation.issues).toHaveLength(1);
    expect(validation.issues[0]?.kind).toBe('schema');
    expect(validation.issues[0]?.path).toBe('/');
    expect(validation.issues[0]?.message).toContain("can't resolve reference https://example.invalid/missing");

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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.3.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it.each([
    ['missing', { type: 'object' }],
    ['non-URI', { $id: 'issue', type: 'object' }],
  ])('reports a %s canonical $id once per output type resource', (_description, schema) => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'output-types', 'issue', 'schema.json'), `${JSON.stringify(schema)}\n`);

    const findings = validateEffectiveSet(resolvedSet(join(root, 'home'), project), project).filter(
      (finding) => finding.message === "output type 'issue' has an invalid schema: missing canonical $id.",
    );

    expect(findings).toEqual([
      {
        severity: 'error',
        resource: 'output-type:issue',
        message: "output type 'issue' has an invalid schema: missing canonical $id.",
      },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.1.6, OFTR-013.3.8, OFTR-013.4.5–6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('exports sorted output type sources and copies the winning schemas from the workflow closure', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    const workspaceAlphaSchema = outputTypeSchemaFor('alpha-type').replace(
      '"type": "object"',
      '"title": "workspace",\n  "type": "object"',
    );
    const globalAlphaSchema = outputTypeSchemaFor('alpha-type').replace(
      '"type": "object"',
      '"title": "global",\n  "type": "object"',
    );
    write(join(home, '.agents', 'output-types', 'alpha-type', 'schema.json'), globalAlphaSchema);
    write(join(catalog, 'output-types', 'alpha-type', 'schema.json'), workspaceAlphaSchema);
    const zuluSchema = outputTypeSchemaFor('zulu-type');
    write(join(catalog, 'output-types', 'zulu-type', 'schema.json'), zuluSchema);
    write(
      join(catalog, 'workflows', 'leaf', 'workflow.yaml'),
      `version: 1
id: leaf
title: Leaf
description: Publish an issue.
actors: {}
outputs:
  alpha: {from: work, type: alpha-type}
nodes:
  - {id: work, action: work, description: Work.}
`,
    );
    write(
      join(catalog, 'workflows', 'root', 'workflow.yaml'),
      `version: 1
id: root
title: Root
description: Publish two output types in non-sorted declaration order.
actors: {}
outputs:
  alpha: {from: publish, type: zulu-type}
  beta: {from: leaf, output: alpha}
nodes:
  - {id: publish, action: publish, description: Publish.}
  - {id: leaf, workflow: leaf, description: Run leaf.}
`,
    );
    write(join(catalog, 'settings.yml'), 'workflows:\n  - root\n');
    const out = join(root, 'dump');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, workflow: 'root', out });

    expect(result.ok).toBe(true);
    expect(readFileSync(join(out, '.agents', 'output-types', 'alpha-type', 'schema.json'), 'utf8')).toBe(
      workspaceAlphaSchema,
    );
    expect(readFileSync(join(out, '.agents', 'output-types', 'zulu-type', 'schema.json'), 'utf8')).toBe(zuluSchema);
    const manifest = JSON.parse(
      readFileSync(join(out, '.agents', '.outfitter', 'workflow-composition.json'), 'utf8'),
    ) as {
      outputTypes: readonly {
        slug: string;
        id: string;
        sha256: string;
        source: { layer: string; path: string };
      }[];
      files: readonly { path: string; sha256: string }[];
    };
    expect(manifest.outputTypes.map((outputType) => outputType.slug)).toEqual(['alpha-type', 'zulu-type']);
    expect(manifest.outputTypes).toEqual([
      {
        slug: 'alpha-type',
        id: schemaId('alpha-type'),
        sha256: createHash('sha256').update(workspaceAlphaSchema).digest('hex'),
        source: { layer: 'workspace', path: 'output-types/alpha-type/schema.json' },
      },
      {
        slug: 'zulu-type',
        id: schemaId('zulu-type'),
        sha256: createHash('sha256').update(zuluSchema).digest('hex'),
        source: { layer: 'workspace', path: 'output-types/zulu-type/schema.json' },
      },
    ]);
    expect(Object.keys(manifest.outputTypes[0] ?? {})).toEqual(['slug', 'id', 'sha256', 'source']);
    const filePaths = manifest.files.map((file) => file.path);
    expect(filePaths).toContain('output-types/alpha-type/schema.json');
    expect(filePaths).toContain('output-types/zulu-type/schema.json');
    for (const outputType of manifest.outputTypes) {
      expect(manifest.files.find((file) => file.path === `output-types/${outputType.slug}/schema.json`)?.sha256).toBe(
        outputType.sha256,
      );
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.1.6, OFTR-013.3.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports a shadowed output type identity as a non-strict warning and a strict failure', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const shadowedSchema = outputTypeSchemaFor('global-issue');
    const winnerSchema = outputTypeSchemaFor('workspace-issue');
    write(join(home, '.agents', 'output-types', 'issue', 'schema.json'), shadowedSchema);
    write(join(project, '.agents', 'output-types', 'issue', 'schema.json'), winnerSchema);
    const warning =
      "output type 'issue' definition in 'global' " +
      `(identity ${schemaId('global-issue')}@${createHash('sha256').update(shadowedSchema).digest('hex')}) ` +
      "is overridden by 'workspace' " +
      `(identity ${schemaId('workspace-issue')}@${createHash('sha256').update(winnerSchema).digest('hex')}).`;

    const nonStrict = executeValidateCommand({ homeDirectory: home, projectDirectory: project });
    const strict = executeValidateCommand({ homeDirectory: home, projectDirectory: project, strict: true });

    expect(nonStrict.ok).toBe(true);
    expect(nonStrict.findings).toContainEqual({ severity: 'warning', resource: 'output-type:issue', message: warning });
    expect(strict.ok).toBe(false);
    expect(strict.findings).toContainEqual({ severity: 'warning', resource: 'output-type:issue', message: warning });
  });

  it('reports distinct output type shadow warnings for three defining layers', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const source = join(root, 'catalog');
    const schemas = {
      workspace: outputTypeSchemaFor('workspace-issue'),
      global: outputTypeSchemaFor('global-issue'),
      [source]: outputTypeSchemaFor('catalog-issue'),
    };
    write(join(project, '.agents', 'output-types', 'issue', 'schema.json'), schemas.workspace);
    write(join(home, '.agents', 'output-types', 'issue', 'schema.json'), schemas.global);
    write(join(source, 'output-types', 'issue', 'schema.json'), schemas[source]);
    write(join(project, '.agents', 'settings.yml'), `sources:\n  - path: ${JSON.stringify(source)}\n`);

    const findings = executeValidateCommand({ homeDirectory: home, projectDirectory: project }).findings.filter(
      (finding) => finding.severity === 'warning' && finding.resource === 'output-type:issue',
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.message)).toEqual([
      "output type 'issue' definition in 'global' " +
        `(identity ${schemaId('global-issue')}@${createHash('sha256').update(schemas.global).digest('hex')}) ` +
        "is overridden by 'workspace' " +
        `(identity ${schemaId('workspace-issue')}@${createHash('sha256').update(schemas.workspace).digest('hex')}).`,
      `output type 'issue' definition in '${source}' ` +
        `(identity ${schemaId('catalog-issue')}@${createHash('sha256').update(schemas[source]).digest('hex')}) ` +
        "is overridden by 'workspace' " +
        `(identity ${schemaId('workspace-issue')}@${createHash('sha256').update(schemas.workspace).digest('hex')}).`,
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.4.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('refuses to dump an output type schema that resolves outside every catalog root', () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const catalog = join(project, '.agents');
    const externalSchema = join(root, 'external-schema.json');
    const schemaPath = join(catalog, 'output-types', 'issue', 'schema.json');
    write(externalSchema, outputTypeSchema);
    mkdirSync(dirname(schemaPath), { recursive: true });
    symlinkSync(externalSchema, schemaPath);
    writeRootWorkflow(catalog);
    const out = join(root, 'dump');

    const result = executeDumpCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      workflow: 'root',
      out,
    });

    expect(result.ok).toBe(false);
    expect(result.messages).toContain("output type 'issue' resolves outside the tree and cannot be safely dumped.");
    expect(existsSync(join(out, '.agents'))).toBe(false);
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
