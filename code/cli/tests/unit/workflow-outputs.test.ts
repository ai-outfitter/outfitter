import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { createListCommand } from '../../src/cli/commands/ListCommand.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { listResources } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { validateEffectiveSet } from '../../src/resolver/ResolverValidation.js';
import { readWorkflowDefinition } from '../../src/resolver/WorkflowDefinition.js';
import type { WorkflowDefinition, WorkflowDefinitionIssue } from '../../src/resolver/WorkflowDefinition.js';
import { resolveWorkflowOutputTypes } from '../../src/resolver/WorkflowOutput.js';

const roots: string[] = [];
const writeWorkflow = (outputs: string): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-workflow-output-schema-'));
  roots.push(root);
  const path = join(root, 'workflow.yaml');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `version: 1
id: delivery
title: Delivery
description: Deliver a change.
actors: {}
outputs:
${outputs}
nodes:
  - {id: draft, action: draft, description: Draft a pull request.}
  - {id: review, workflow: review, description: Review the pull request.}
`,
  );
  return path;
};

const readIssue = (outputs: string): WorkflowDefinitionIssue =>
  readWorkflowDefinition(writeWorkflow(outputs)) as WorkflowDefinitionIssue;

const writeCatalogWorkflow = (catalog: string, slug: string, content: string): void => {
  const path = join(catalog, 'workflows', slug, 'workflow.yaml');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const outputTypeSchemaId = (slug: string): string => `https://schemas.example.test/output-types/${slug}`;

const outputTypeSchema = (slug: string): string =>
  JSON.stringify(
    {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: outputTypeSchemaId(slug),
      type: 'object',
      additionalProperties: true,
      required: ['number', 'html_url'],
      properties: {
        number: { type: 'integer', minimum: 1 },
        html_url: { type: 'string', format: 'uri' },
      },
    },
    null,
    2,
  );

const writeCatalogOutputType = (catalog: string, slug: string, content: string = outputTypeSchema(slug)): string => {
  const path = join(catalog, 'output-types', slug, 'schema.json');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${content}\n`);
  return path;
};

const resolveCatalog = (
  catalogWorkflows: Readonly<Record<string, string>>,
  catalogOutputTypes: Readonly<Record<string, string>> = {
    issue: outputTypeSchema('issue'),
    'git-commit': outputTypeSchema('git-commit'),
  },
) => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-workflow-output-catalog-'));
  roots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  const catalog = join(project, '.agents');
  for (const [slug, content] of Object.entries(catalogWorkflows)) writeCatalogWorkflow(catalog, slug, content);
  for (const [slug, content] of Object.entries(catalogOutputTypes)) writeCatalogOutputType(catalog, slug, content);
  const set = resolveResources(
    discoverLayers({ homeDirectory: home, projectDirectory: project, settings: { sources: [] } }).layers,
  );
  return { catalog, home, project, root, set };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.2).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
describe('workflow output declaration schema', () => {
  it('parses action outputs and nested output mappings', () => {
    const result = readWorkflowDefinition(
      writeWorkflow(`  pull-request:
    from: draft
    type: pull-request
  verdict:
    from: review
    output: verdict
`),
    ) as WorkflowDefinition;

    expect(result.outputs).toEqual({
      'pull-request': { from: 'draft', type: 'pull-request' },
      verdict: { from: 'review', output: 'verdict' },
    });
  });

  it.each([
    ['both type and output', '  result: {from: draft, type: issue, output: verdict}\n'],
    ['neither type nor output', '  result: {from: draft}\n'],
    ['an invalid output name', '  BadName: {from: draft, type: issue}\n'],
    ['an extra output entry key', '  result: {from: draft, type: issue, label: Result}\n'],
  ])('rejects %s', (_description, outputs) => {
    expect(readIssue(outputs).message).toContain('workflow.yaml is invalid');
  });

  it('accepts an output type using the resource slug pattern', () => {
    const definition = readWorkflowDefinition(
      writeWorkflow('  result: {from: draft, type: organization-deployment}\n'),
    ) as WorkflowDefinition;

    expect(definition.outputs?.result).toEqual({ from: 'draft', type: 'organization-deployment' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects an output name that starts with a number', () => {
    expect(readIssue('  2: {from: draft, type: issue}\n').message).toContain('workflow.yaml is invalid');
  });

  it('rejects duplicate YAML output keys', () => {
    expect(
      readIssue(`  result: {from: draft, type: issue}
  result: {from: draft, type: git-commit}
`).message,
    ).toContain('workflow.yaml is not valid YAML');
  });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.2). YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES. Output sources and nested mappings resolve only across compatible nodes and declared nested outputs.
describe('workflow output reference validation', () => {
  it('reports every invalid output source and mapping shape', () => {
    const { project, set } = resolveCatalog({
      child: `version: 1
id: child
title: Child
description: Child workflow.
actors: {}
nodes:
  - {id: work, action: work, description: Work.}
`,
      invalid: `version: 1
id: invalid
title: Invalid
description: Invalid output references.
actors: {}
outputs:
  missing-source: {from: absent, type: issue}
  workflow-with-type: {from: nested, type: issue}
  action-with-output: {from: work, output: result}
  missing-nested-output: {from: nested, output: absent}
nodes:
  - {id: work, action: work, description: Work.}
  - {id: nested, workflow: child, description: Run child.}
`,
    });

    expect(validateEffectiveSet(set, project).map((finding) => finding.message)).toEqual(
      expect.arrayContaining([
        "output 'missing-source' references unknown node 'absent'.",
        "output 'workflow-with-type' uses type with workflow node 'nested'; nested workflow outputs must use output.",
        "output 'action-with-output' maps output from action node 'work'; action outputs must use type.",
        "output 'missing-nested-output' references unknown output 'absent' on workflow 'child'.",
      ]),
    );
    const definitions = new Map(
      listResources(set, 'workflow').map((resource) => [
        resource.slug,
        readWorkflowDefinition(resource.winner.path) as WorkflowDefinition,
      ]),
    );
    expect(resolveWorkflowOutputTypes(definitions.get('invalid')!, definitions)).toEqual({});
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports incompatible workflow-node sources for an output named constructor', () => {
    const { project, set } = resolveCatalog({
      child: `version: 1
id: child
title: Child
description: Child workflow.
actors: {}
nodes:
  - {id: work, action: work, description: Work.}
`,
      root: `version: 1
id: root
title: Root
description: Exercise a prototype-named output.
actors: {}
outputs:
  constructor: {from: nested, type: issue}
nodes:
  - {id: nested, workflow: child, description: Run child.}
`,
    });

    expect(validateEffectiveSet(set, project).map((finding) => finding.message)).toContain(
      "output 'constructor' uses type with workflow node 'nested'; nested workflow outputs must use output.",
    );
  });

  it('resolves output types through a two-level nested mapping chain', () => {
    const { project, set } = resolveCatalog({
      leaf: `version: 1
id: leaf
title: Leaf
description: Produce a verdict.
actors: {}
outputs:
  verdict: {from: decide, type: issue}
nodes:
  - {id: decide, action: decide, description: Decide.}
`,
      middle: `version: 1
id: middle
title: Middle
description: Map the leaf verdict.
actors: {}
outputs:
  result: {from: leaf, output: verdict}
nodes:
  - {id: leaf, workflow: leaf, description: Run leaf.}
`,
      root: `version: 1
id: root
title: Root
description: Map the middle result.
actors: {}
outputs:
  final: {from: middle, output: result}
nodes:
  - {id: middle, workflow: middle, description: Run middle.}
`,
    });
    const findings = validateEffectiveSet(set, project);
    const definitions = new Map(
      listResources(set, 'workflow').map((resource) => {
        const definition = readWorkflowDefinition(resource.winner.path) as WorkflowDefinition;
        return [resource.slug, definition] as const;
      }),
    );

    expect(findings).toEqual([]);
    expect(resolveWorkflowOutputTypes(definitions.get('root')!, definitions)).toEqual({
      final: { from: 'middle', type: 'issue', output: 'result' },
    });
  });

  it('does not add an output error when the nested workflow itself is unknown', () => {
    const { project, set } = resolveCatalog({
      root: `version: 1
id: root
title: Root
description: Reference an unknown workflow once.
actors: {}
outputs:
  final: {from: missing, output: result}
nodes:
  - {id: missing, workflow: absent, description: Run missing workflow.}
`,
    });
    const messages = validateEffectiveSet(set, project).map((finding) => finding.message);
    const definition = readWorkflowDefinition(
      listResources(set, 'workflow').find((resource) => resource.slug === 'root')!.winner.path,
    ) as WorkflowDefinition;

    expect(messages.filter((message) => message.includes("workflow 'absent'"))).toEqual([
      "node 'missing' references unknown workflow 'absent'.",
    ]);
    expect(messages.some((message) => message.includes("output 'final'"))).toBe(false);
    expect(resolveWorkflowOutputTypes(definition, new Map([['root', definition]]))).toEqual({});
  });

  it('bounds output resolution when invalid nested definitions form a cycle', () => {
    const cyclic = {
      version: 1,
      id: 'cycle',
      title: 'Cycle',
      description: 'Cycle output mappings.',
      actors: {},
      outputs: { result: { from: 'again', output: 'result' } },
      nodes: [{ id: 'again', workflow: 'cycle', description: 'Recurse.' }],
    } satisfies WorkflowDefinition;

    expect(resolveWorkflowOutputTypes(cyclic, new Map([['cycle', cyclic]]))).toEqual({});
  });
});

const resolvedOutputCatalog = () =>
  resolveCatalog({
    leaf: `version: 1
id: leaf
title: Leaf
description: Produce outputs.
actors: {}
outputs:
  z-commit: {from: commit, type: git-commit}
  verdict: {from: decide, type: issue}
nodes:
  - {id: commit, action: commit, description: Commit.}
  - {id: decide, action: decide, description: Decide.}
`,
    root: `version: 1
id: root
title: Root
description: Map the leaf verdict.
actors: {}
outputs:
  final: {from: leaf, output: verdict}
nodes:
  - {id: leaf, workflow: leaf, description: Run leaf.}
`,
  });

const enableWorkflow = (catalog: string, slug: string): void => {
  writeFileSync(join(catalog, 'settings.yml'), `workflows:\n  - ${slug}\n`);
};

interface WorkflowManifest {
  readonly workflows: readonly {
    readonly id: string;
    readonly outputs: Readonly<
      Record<
        string,
        { readonly from: string; readonly type: string; readonly schema: string; readonly output?: string }
      >
    >;
  }[];
}

const readWorkflowManifest = (out: string): WorkflowManifest =>
  JSON.parse(readFileSync(join(out, '.agents', '.outfitter', 'workflow-composition.json'), 'utf8')) as WorkflowManifest;

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.4, OFTR-013.4.6). YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES. JSON listings and deterministic dump manifests name-sort resolved outputs, carry canonical schema IDs, and dumps preserve workflow source bytes verbatim.
describe('workflow output listing and export', () => {
  it('includes resolved inherited outputs in list workflows --json', async () => {
    const { catalog, home, project } = resolvedOutputCatalog();
    writeFileSync(join(catalog, 'settings.yml'), 'workflows:\n  - root\n  - leaf\n');
    const lines: string[] = [];
    const program = new Command();
    createListCommand({
      homeDirectory: home,
      projectDirectory: project,
      writeLine: (line) => lines.push(line),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'list', 'workflows', '--json']);

    const payload = JSON.parse(lines[0]) as {
      resources: readonly {
        readonly slug: string;
        readonly outputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
      }[];
    };
    expect(payload.resources).toHaveLength(2);
    const root = payload.resources.find((resource) => resource.slug === 'root');
    expect(root).toMatchObject({
      slug: 'root',
      outputs: {
        final: { from: 'leaf', type: 'issue', schema: outputTypeSchemaId('issue'), output: 'verdict' },
      },
    });
    expect(Object.keys(root?.outputs.final ?? {})).toEqual(['from', 'type', 'schema', 'output']);
    expect(Object.keys(payload.resources.find((resource) => resource.slug === 'leaf')?.outputs ?? {})).toEqual([
      'verdict',
      'z-commit',
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-013.2, OFTR-013.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves and lists a valid output named constructor', async () => {
    const { catalog, home, project } = resolveCatalog({
      root: `version: 1
id: root
title: Root
description: Publish a prototype-named output.
actors: {}
outputs:
  constructor: {from: work, type: issue}
nodes:
  - {id: work, action: work, description: Work.}
`,
    });
    enableWorkflow(catalog, 'root');
    const lines: string[] = [];
    const program = new Command();
    createListCommand({
      homeDirectory: home,
      projectDirectory: project,
      writeLine: (line) => lines.push(line),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'list', 'workflows', '--json']);

    const payload = JSON.parse(lines[0]) as {
      resources: readonly { readonly slug: string; readonly outputs: Readonly<Record<string, unknown>> }[];
    };
    expect(payload.resources[0]?.outputs).toEqual({
      constructor: { from: 'work', type: 'issue', schema: outputTypeSchemaId('issue') },
    });
  });

  it('uses an empty outputs object when listing a malformed workflow definition', async () => {
    const { catalog, home, project } = resolveCatalog({ broken: 'version: [\n' });
    enableWorkflow(catalog, 'broken');
    const lines: string[] = [];
    const program = new Command();
    createListCommand({
      homeDirectory: home,
      projectDirectory: project,
      writeLine: (line) => lines.push(line),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'list', 'workflows', '--json']);

    const payload = JSON.parse(lines[0]) as { resources: readonly { readonly outputs: unknown }[] };
    expect(payload.resources[0]?.outputs).toEqual({});
  });

  it('records resolved outputs for every workflow in the composition manifest', () => {
    const { catalog, home, project, root } = resolvedOutputCatalog();
    enableWorkflow(catalog, 'root');
    const out = join(root, 'dump');

    expect(executeDumpCommand({ homeDirectory: home, projectDirectory: project, workflow: 'root', out }).ok).toBe(true);
    const workflows = readWorkflowManifest(out).workflows;
    expect(workflows).toEqual([
      {
        id: 'root',
        outputs: {
          final: { from: 'leaf', type: 'issue', schema: outputTypeSchemaId('issue'), output: 'verdict' },
        },
        source: { layer: 'workspace', path: 'workflows/root/workflow.yaml' },
      },
      {
        id: 'leaf',
        outputs: {
          verdict: { from: 'decide', type: 'issue', schema: outputTypeSchemaId('issue') },
          'z-commit': { from: 'commit', type: 'git-commit', schema: outputTypeSchemaId('git-commit') },
        },
        source: { layer: 'workspace', path: 'workflows/leaf/workflow.yaml' },
      },
    ]);
    expect(Object.keys(workflows[0]?.outputs.final ?? {})).toEqual(['from', 'type', 'schema', 'output']);
    expect(Object.keys(workflows.find((workflow) => workflow.id === 'leaf')?.outputs ?? {})).toEqual([
      'verdict',
      'z-commit',
    ]);
    expect(
      readFileSync(join(out, '.agents', 'workflows', 'leaf', 'workflow.yaml')).equals(
        readFileSync(join(catalog, 'workflows', 'leaf', 'workflow.yaml')),
      ),
    ).toBe(true);
  });

  it('exports an empty outputs object for a workflow without declarations', () => {
    const { catalog, home, project, root } = resolveCatalog({
      plain: `version: 1
id: plain
title: Plain
description: No outputs.
actors: {}
nodes:
  - {id: work, action: work, description: Work.}
`,
    });
    enableWorkflow(catalog, 'plain');
    const out = join(root, 'plain-dump');

    expect(executeDumpCommand({ homeDirectory: home, projectDirectory: project, workflow: 'plain', out }).ok).toBe(
      true,
    );
    expect(readWorkflowManifest(out).workflows[0]?.outputs).toEqual({});
  });

  it('writes byte-identical files across two dumps with mapped outputs', () => {
    const { catalog, home, project, root } = resolvedOutputCatalog();
    enableWorkflow(catalog, 'root');
    const firstOut = join(root, 'first');
    const secondOut = join(root, 'second');
    const first = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'root',
      out: firstOut,
    });
    const second = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      workflow: 'root',
      out: secondOut,
    });
    const firstRoot = join(firstOut, '.agents');
    const secondRoot = join(secondOut, '.agents');
    const firstFiles = first.writtenPaths.map((path) => relative(firstRoot, path));
    const secondFiles = second.writtenPaths.map((path) => relative(secondRoot, path));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(secondFiles).toEqual(firstFiles);
    for (const path of firstFiles) {
      expect(readFileSync(join(firstRoot, path)).equals(readFileSync(join(secondRoot, path)))).toBe(true);
    }
  });
});
