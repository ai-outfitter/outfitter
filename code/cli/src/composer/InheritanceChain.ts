import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { AgentDefinition } from '../resolver/AgentDefinition.js';
import type { EffectiveResourceSet, ResolvedResource } from '../resolver/Resource.js';
import { findResource } from '../resolver/Resource.js';
import type { CompositionDiagnostic } from './CompositionDiagnostic.js';

export interface ChainEntry {
  readonly resource: ResolvedResource;
  readonly definition: AgentDefinition;
}

export interface InheritanceChainResult {
  readonly entries?: readonly ChainEntry[];
  readonly errors: readonly CompositionDiagnostic[];
}

const reportCycle = (
  set: EffectiveResourceSet,
  slug: string,
  visiting: readonly string[],
  errors: CompositionDiagnostic[],
): boolean => {
  const cycleIndex = visiting.indexOf(slug);
  if (cycleIndex === -1) return false;
  const declaringSlug = visiting.at(-1)!;
  errors.push({
    severity: 'error',
    code: 'inheritance-cycle',
    sourcePath: findResource(set, 'agent', declaringSlug)?.winner.path,
    message: `Agent inheritance cycle detected: ${[...visiting.slice(cycleIndex), slug].join(' -> ')}.`,
  });
  return true;
};

const readChainEntry = (resource: ResolvedResource, errors: CompositionDiagnostic[]): ChainEntry | undefined => {
  const definition = readAgentDefinition(resource.winner.path, resource.configPaths);
  if (isAgentDefinitionIssue(definition)) {
    errors.push({
      severity: 'error',
      code: 'resource-invalid',
      sourcePath: definition.path,
      message: `Agent '${resource.slug}' is invalid: ${definition.message}`,
    });
    return undefined;
  }
  if (definition.name !== resource.slug) {
    errors.push({
      severity: 'error',
      code: 'resource-invalid',
      sourcePath: definition.sourcePath,
      message: `Agent '${resource.slug}' is invalid: agent.md name '${definition.name}' must match its directory.`,
    });
    return undefined;
  }
  return { resource, definition };
};

export const resolveInheritanceChain = (set: EffectiveResourceSet, agentSlug: string): InheritanceChainResult => {
  const entries: ChainEntry[] = [];
  const composed = new Set<string>();
  const visiting: string[] = [];
  const errors: CompositionDiagnostic[] = [];

  const visit = (slug: string): void => {
    if (composed.has(slug)) return;
    if (reportCycle(set, slug, visiting, errors)) return;

    const resource = findResource(set, 'agent', slug);
    if (resource === undefined) {
      errors.push({
        severity: 'error',
        code: 'resource-unresolved',
        sourcePath: findResource(set, 'agent', visiting.at(-1)!)?.winner.path,
        message: `Agent inheritance references unknown parent '${slug}' in chain ${[...visiting, slug].join(' -> ')}.`,
      });
      return;
    }

    const entry = readChainEntry(resource, errors);
    if (entry === undefined) return;
    const { definition } = entry;

    visiting.push(slug);
    for (const parent of definition.inherits) visit(parent);
    visiting.pop();

    if (!composed.has(slug)) {
      composed.add(slug);
      entries.push(entry);
    }
  };

  visit(agentSlug);
  return errors.length > 0 ? { errors } : { entries, errors };
};
