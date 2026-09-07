import type { WorkflowDefinition, WorkflowOutput } from './WorkflowDefinition.js';

export interface ResolvedWorkflowOutput {
  readonly from: string;
  readonly type: string;
  readonly schema: string;
  readonly output?: string;
}

export type ResolvedWorkflowOutputs = Readonly<Record<string, ResolvedWorkflowOutput>>;

interface ResolvedWorkflowOutputType {
  readonly from: string;
  readonly type: string;
  readonly output?: string;
}

type ResolvedWorkflowOutputTypes = Readonly<Record<string, ResolvedWorkflowOutputType>>;

const resolvedActionType = (definition: WorkflowDefinition, output: WorkflowOutput): string | undefined => {
  const node = definition.nodes.find((candidate) => candidate.id === output.from);
  return node?.action === undefined ? undefined : output.type;
};

const resolvedMappedType = (
  workflowSlug: string | undefined,
  outputName: string,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  visited: ReadonlySet<string>,
): string | undefined => {
  if (workflowSlug === undefined) return undefined;
  const nested = definitions.get(workflowSlug);
  if (nested === undefined) return undefined;
  const nestedOutputs = nested.outputs ?? {};
  if (!Object.hasOwn(nestedOutputs, outputName)) return undefined;
  const nestedOutput = nestedOutputs[outputName];

  const key = `${nested.id}\u0000${outputName}`;
  if (visited.has(key)) return undefined;
  return resolvedType(nested, nestedOutput, definitions, new Set([...visited, key]));
};

const resolvedType = (
  definition: WorkflowDefinition,
  output: WorkflowOutput,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  visited: ReadonlySet<string>,
): string | undefined => {
  if (output.type !== undefined) return resolvedActionType(definition, output);
  const workflowSlug = definition.nodes.find((candidate) => candidate.id === output.from)?.workflow;
  return resolvedMappedType(workflowSlug, output.output, definitions, visited);
};

/** Resolves and name-sorts output declarations to their catalog slugs without mutating inputs. */
export const resolveWorkflowOutputTypes = (
  definition: WorkflowDefinition,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
): ResolvedWorkflowOutputTypes => {
  const resolved = Object.create(null) as Record<string, ResolvedWorkflowOutputType>;
  const outputs = definition.outputs ?? {};
  for (const name of Object.keys(outputs).sort()) {
    const output = outputs[name];
    const type = resolvedType(definition, output, definitions, new Set([`${definition.id}\u0000${name}`]));
    if (type === undefined) continue;
    resolved[name] =
      output.output === undefined ? { from: output.from, type } : { from: output.from, type, output: output.output };
  }
  return { ...resolved };
};

/** Binds resolved output slugs to canonical schema IDs and omits types without an identity. */
export const resolveWorkflowOutputs = (
  definition: WorkflowDefinition,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  schemaIds: ReadonlyMap<string, string>,
): ResolvedWorkflowOutputs => {
  const resolved = Object.create(null) as Record<string, ResolvedWorkflowOutput>;
  for (const [name, output] of Object.entries(resolveWorkflowOutputTypes(definition, definitions))) {
    const schema = schemaIds.get(output.type);
    if (schema === undefined) continue;
    resolved[name] =
      output.output === undefined
        ? { from: output.from, type: output.type, schema }
        : { from: output.from, type: output.type, schema, output: output.output };
  }
  return { ...resolved };
};
