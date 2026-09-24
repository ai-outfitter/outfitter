// Provides `outfitter list [kind]` over the effective resource set, plus the machine-local `extensions`
// kind that reports the cached pi extension packages (`extensions` is not a resolver resource kind:
// it reads the extension cache state directly and needs neither settings nor a project). Agent-scoped
// listings compose the agent's inherited loadout selections through the shared composer machinery
// so the listing shows the effective view a run would compose, with declaring-owner provenance.
import { join } from 'node:path';

import { Command } from 'commander';

import { resolveInheritanceChain } from '../../composer/Chain.js';
import { declaredSelections } from '../../composer/Composer.js';
import { resolveCommandResource, resolveSelectionResource } from '../../composer/Defaults.js';
import { buildExtensionReport } from '../../extensions/ExtensionReport.js';
import type { ExtensionReportEntry } from '../../extensions/ExtensionReport.js';
import type { NpmLatestResolver } from '../../extensions/PiExtensionCache.js';
import type { EffectiveResourceSet, ResolvedResource, ResourceKind } from '../../resolver/Resource.js';
import { resolveOutfitterCacheDir } from '../../paths/OutfitterCache.js';
import {
  agentLocalKinds,
  compareSlugs,
  findResource,
  listAgentResources,
  listResources,
  resourceKinds,
} from '../../resolver/Resource.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import { isWorkflowDefinitionIssue, readWorkflowDefinition } from '../../resolver/WorkflowDefinition.js';
import type { WorkflowDefinition } from '../../resolver/WorkflowDefinition.js';
import { resolveWorkflowOutputs } from '../../resolver/WorkflowOutput.js';
import type { ResolvedWorkflowOutputs } from '../../resolver/WorkflowOutput.js';
import { formatSettingsIssue } from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface ListInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly kind?: string;
  readonly agent?: string;
  readonly strict?: boolean;
  /** Skip upstream update lookups for the `extensions` kind and report cached state only. */
  readonly offline?: boolean;
}

export interface ListResult {
  readonly exitCode: number;
  readonly messages: readonly string[];
  readonly resources: readonly ListResourceEntry[];
  /** Present only for the `extensions` kind: the underlying report entries. */
  readonly extensions?: readonly ExtensionReportEntry[];
}

export interface ListResourceEntry {
  readonly kind: ResourceKind;
  readonly slug: string;
  readonly layer: string;
  readonly path: string;
  readonly ownerAgent: string | null;
  /** Present only on inherited selections: the declaring agent in the `inherits` chain. */
  readonly inherited?: boolean;
  readonly declaredBy?: string;
  readonly outputs?: ResolvedWorkflowOutputs;
}

export interface ListCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
  /** Test seam for the registry resolver behind the `extensions` kind's upstream checks. */
  readonly extensionNpmLatest?: NpmLatestResolver;
}

const kindByPlural: ReadonlyMap<string, ResourceKind> = new Map([
  ['agents', 'agent'],
  ['skills', 'skill'],
  ['knowledge', 'knowledge'],
  ['commands', 'command'],
  ['workflows', 'workflow'],
]);

const pluralByKind: ReadonlyMap<ResourceKind, string> = new Map([
  ['agent', 'agents'],
  ['skill', 'skills'],
  ['knowledge', 'knowledge'],
  ['command', 'commands'],
  ['workflow', 'workflows'],
]);

const resolveKindFilter = (kind: string | undefined): readonly ResourceKind[] => {
  if (kind === undefined) {
    return resourceKinds;
  }

  const resolved = kindByPlural.get(kind);

  if (resolved === undefined) {
    throw new Error(`Unknown resource kind '${kind}'. Expected one of: ${[...kindByPlural.keys()].join(', ')}.`);
  }

  return [resolved];
};

const assertKnownAgent = (set: EffectiveResourceSet, agent: string | undefined): void => {
  if (agent !== undefined && findResource(set, 'agent', agent) === undefined) {
    throw new Error(`Unknown agent '${agent}'. Run 'outfitter list agents' to see resolvable agents.`);
  }
};

const listGlobalResources = (set: EffectiveResourceSet, kind: ResourceKind, enabledWorkflows: readonly string[]) =>
  kind === 'workflow'
    ? enabledWorkflows.flatMap((slug) => {
        const resource = findResource(set, 'workflow', slug);
        return resource === undefined ? [] : [resource];
      })
    : listResources(set, kind);

const readWorkflowDefinitions = (set: EffectiveResourceSet): ReadonlyMap<string, WorkflowDefinition> => {
  const definitions = new Map<string, WorkflowDefinition>();
  for (const resource of listResources(set, 'workflow')) {
    const definition = readWorkflowDefinition(resource.winner.path);
    if (!isWorkflowDefinitionIssue(definition)) definitions.set(resource.slug, definition);
  }
  return definitions;
};

const workflowDefinitionsForKinds = (
  set: EffectiveResourceSet,
  kinds: readonly ResourceKind[],
): ReadonlyMap<string, WorkflowDefinition> =>
  kinds.includes('workflow') ? readWorkflowDefinitions(set) : new Map<string, WorkflowDefinition>();

/** One listing row: the resolved resource plus optional inherited-selection provenance. */
interface ListedResource {
  readonly resource: ResolvedResource;
  readonly declaredBy?: string;
}

/**
 * Composes the agent's inherited loadout selections for one kind through the shared composer
 * machinery — parent-first with stable de-duplication (OFTR-003.10.2) — and resolves each
 * selection against its declaring agent's namespace with catalog-wide fallback (OFTR-003.10.5).
 * The agent's own declarations are skipped: its own local resources and the catalog already
 * cover them. Unresolved selections surface as the composer's warnings and are omitted.
 */
const inheritedSelections = (
  set: EffectiveResourceSet,
  agent: string,
  kind: 'skill' | 'command',
  warnings: string[],
): readonly ListedResource[] => {
  const chain = resolveInheritanceChain(set, agent);
  if (chain.entries === undefined) {
    for (const error of chain.errors) warnings.push(error);
    return [];
  }
  const inherited: ListedResource[] = [];
  const selections = declaredSelections(chain.entries, (definition) =>
    kind === 'skill' ? definition.loadout.skills : definition.loadout.commands,
  );
  for (const selection of selections) {
    if (selection.owner === undefined || selection.owner === agent) continue;
    if (kind === 'command') {
      const outcome = resolveCommandResource(set, selection);
      if (outcome.resource !== undefined) {
        inherited.push({ resource: outcome.resource, declaredBy: selection.owner });
      } else if (outcome.ambiguousCandidates !== undefined) {
        warnings.push(
          `loadout commands references ambiguous command '${selection.slug}' (${outcome.ambiguousCandidates.join(', ')}).`,
        );
      } else warnings.push(`loadout commands references unknown command '${selection.slug}'.`);
    } else {
      const resource = resolveSelectionResource(set, kind, selection);
      if (resource === undefined) {
        warnings.push(`loadout skills references unknown skill '${selection.slug}'.`);
      } else {
        inherited.push({ resource, declaredBy: selection.owner });
      }
    }
  }
  return inherited;
};

/**
 * Text labels reuse the existing `[<layer>[; agent-local]]` vocabulary; inherited entries prefix
 * `inherited; owner: <declaring agent>` and add `agent-local` only when the selection resolves
 * into the declaring agent's local namespace.
 */
const renderListedResource = (listed: ListedResource): string => {
  const { resource, declaredBy } = listed;
  const agentLocal = resource.winner.ownerAgent === undefined ? '' : '; agent-local';
  if (declaredBy === undefined) {
    return `  ${resource.slug}  [${resource.winner.layer.label}${agentLocal}]`;
  }
  const ownerLocal = resource.winner.ownerAgent === declaredBy ? '; agent-local' : '';
  return `  ${resource.slug}  [${resource.winner.layer.label}; inherited; owner: ${declaredBy}${ownerLocal}]`;
};

const listEntry = (listed: ListedResource, definitions: ReadonlyMap<string, WorkflowDefinition>): ListResourceEntry => {
  const { resource } = listed;
  const provenance = {
    kind: resource.kind,
    slug: resource.slug,
    layer: resource.winner.layer.label,
    path: resource.winner.path,
    ownerAgent: resource.winner.ownerAgent ?? null,
  };
  if (listed.declaredBy !== undefined) {
    return { ...provenance, inherited: true, declaredBy: listed.declaredBy };
  }
  if (resource.kind !== 'workflow') return provenance;
  const definition = definitions.get(resource.slug);
  return {
    ...provenance,
    outputs: definition === undefined ? {} : resolveWorkflowOutputs(definition, definitions),
  };
};

const renderExtensionStatus = (entry: ExtensionReportEntry): string =>
  entry.statusDetail === undefined ? entry.status : `${entry.status} (${entry.statusDetail})`;

const renderExtensionVersion = (entry: ExtensionReportEntry): string => {
  if (entry.kind === 'npm') return entry.resolvedVersion ?? '(unreadable)';
  if (entry.headSha === undefined) return '(unreadable)';
  const shortSha = entry.headSha.slice(0, 7);
  return entry.pinnedRef === undefined ? shortSha : `${entry.pinnedRef} @ ${shortSha}`;
};

const renderExtensionEntry = (entry: ExtensionReportEntry): string =>
  `  ${entry.specifier}  ${renderExtensionVersion(entry)}  ${renderExtensionStatus(entry)}`;

/** The `extensions` kind reports the machine-local extension cache; no settings or project apply. */
const executeListExtensionsCommand = (input: ListInput, npmLatest?: NpmLatestResolver): ListResult => {
  if (input.agent !== undefined) {
    throw new Error("The --agent option does not apply to 'extensions': the extension cache is shared across agents.");
  }
  const cacheAgentDir = join(resolveOutfitterCacheDir(process.env, input.homeDirectory), 'pi-extensions');
  const offline = input.offline === true || process.env.PI_OFFLINE === '1' || process.env.PI_OFFLINE === 'true';
  const report = buildExtensionReport({ cacheAgentDir, offline, npmLatest });
  const messages = [
    'extensions:',
    ...(report.entries.length === 0 ? ['  (none)'] : report.entries.map(renderExtensionEntry)),
    ...report.warnings.map((warning) => `warning: ${warning}`),
  ];
  return {
    exitCode: input.strict === true && report.warnings.length > 0 ? 1 : 0,
    messages,
    resources: [],
    extensions: report.entries,
  };
};

/**
 * Builds one kind's listing rows and text section. The merge order gives the display precedence:
 * an inherited selection replaces the catalog winner it resolves, and the agent's own
 * agent-local resource shadows both (owned wins).
 */
const listKindResources = (
  set: EffectiveResourceSet,
  kind: ResourceKind,
  agent: string | undefined,
  enabledWorkflows: readonly string[],
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  listingWarnings: string[],
): { readonly entries: readonly ListResourceEntry[]; readonly lines: readonly string[] } => {
  const hasAgentContext = agent !== undefined && agentLocalKinds.includes(kind);
  const globalResources = listGlobalResources(set, kind, enabledWorkflows);
  const inheritedResources =
    agent !== undefined && (kind === 'skill' || kind === 'command')
      ? inheritedSelections(set, agent, kind, listingWarnings)
      : [];
  const localResources = hasAgentContext ? listAgentResources(set, agent, kind) : [];
  const resources = new Map<string, ListedResource>(globalResources.map((resource) => [resource.slug, { resource }]));
  for (const inherited of inheritedResources) resources.set(inherited.resource.slug, inherited);
  for (const resource of localResources) resources.set(resource.slug, { resource });
  const listed = [...resources.values()].sort((left, right) => compareSlugs(left.resource.slug, right.resource.slug));

  return {
    entries: listed.map((entry) => listEntry(entry, definitions)),
    lines: [
      `${pluralByKind.get(kind)!}${hasAgentContext ? ` (agent ${agent})` : ''}:`,
      ...(resources.size === 0 ? ['  (none)'] : listed.map(renderListedResource)),
    ],
  };
};

export const executeListCommand = (input: ListInput, npmLatest?: NpmLatestResolver): ListResult => {
  if (input.kind === 'extensions') return executeListExtensionsCommand(input, npmLatest);
  const { set, settings, settingsIssues, warnings } = resolveEffectiveSet(input);

  if (settingsIssues.length > 0) {
    const detail = settingsIssues.map(formatSettingsIssue).join('; ');
    throw new Error(`Cannot list resources with invalid settings: ${detail}`);
  }

  assertKnownAgent(set, input.agent);

  const listingWarnings: string[] = [];
  const entries: ListResourceEntry[] = [];
  const sections: string[] = [];
  for (const kind of resolveKindFilter(input.kind)) {
    const kindListing = listKindResources(
      set,
      kind,
      input.agent,
      settings.workflows!,
      workflowDefinitionsForKinds(set, [kind]),
      listingWarnings,
    );
    entries.push(...kindListing.entries);
    sections.push(...kindListing.lines);
  }

  // Chain errors repeat per composed kind; report each diagnostic once, in first-seen order.
  const messages: string[] = [
    ...warnings.map((warning) => `warning: ${warning}`),
    ...[...new Set(listingWarnings)].map((warning) => `warning: ${warning}`),
    ...sections,
  ];
  return { exitCode: 0, messages, resources: entries };
};

export const createListCommand = (dependencies: ListCommandDependencies = {}): CommandObject => ({
  name: 'list',
  description:
    'List resolvable resources (agents, skills, knowledge, commands, workflows), or the cached pi extensions.',
  register(program: Command): void {
    program.addCommand(
      new Command('list')
        .description(
          'List resolvable resources (agents, skills, knowledge, commands, workflows), or the cached pi extensions.',
        )
        .argument('[kind]', 'Restrict to one kind: agents, skills, knowledge, commands, workflows, or extensions.')
        .option('--strict', 'Reject incomplete or unsupported requested composition.')
        .option('--json', 'Emit stable machine-readable JSON with resource provenance.')
        .option(
          '--agent <id>',
          'Resolve resources in an agent context, including its agent-local skills/knowledge/commands.',
        )
        .option('--offline', 'For extensions: skip upstream update lookups and report cached state only.')
        .action(
          (
            kind: string | undefined,
            options: { agent?: string; strict?: boolean; json?: boolean; offline?: boolean },
          ) => {
            const result = executeListCommand(
              {
                /* v8 ignore next 2 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
                homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
                projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
                kind,
                agent: options.agent,
                strict: options.strict,
                offline: options.offline,
              },
              dependencies.extensionNpmLatest,
            );

            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            const write = dependencies.writeLine ?? console.log;
            if (options.json === true && result.extensions !== undefined)
              write(
                JSON.stringify(
                  {
                    ok: result.exitCode === 0,
                    extensions: result.extensions,
                    diagnostics: result.messages.filter((message) => message.startsWith('warning: ')),
                  },
                  null,
                  2,
                ),
              );
            else if (options.json === true)
              write(
                JSON.stringify(
                  { ok: result.exitCode === 0, resources: result.resources, diagnostics: result.messages },
                  null,
                  2,
                ),
              );
            else for (const message of result.messages) write(message);

            if (result.exitCode !== 0) process.exitCode = result.exitCode;
          },
        ),
    );
  },
});
