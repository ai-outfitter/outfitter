// Provides `outfitter list [kind]` over the effective resource set.

import { Command } from 'commander';

import type { ResourceKind } from '../../resolver/Resource.js';
import {
  compareSlugs,
  findResource,
  listAgentResources,
  listResources,
  resourceKinds,
} from '../../resolver/Resource.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface ListInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly kind?: string;
  readonly agent?: string;
}

export interface ListResult {
  readonly messages: readonly string[];
}

export interface ListCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

const kindByPlural: ReadonlyMap<string, ResourceKind> = new Map([
  ['agents', 'agent'],
  ['skills', 'skill'],
  ['knowledge', 'knowledge'],
  ['commands', 'command'],
]);

const pluralByKind: ReadonlyMap<ResourceKind, string> = new Map([
  ['agent', 'agents'],
  ['skill', 'skills'],
  ['knowledge', 'knowledge'],
  ['command', 'commands'],
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

export const executeListCommand = (input: ListInput): ListResult => {
  const { set, settingsIssues } = resolveEffectiveSet(input);

  if (settingsIssues.length > 0) {
    const detail = settingsIssues.map((issue) => `${issue.filePath}#${issue.path} ${issue.message}`).join('; ');
    throw new Error(`Cannot list resources with invalid settings: ${detail}`);
  }

  const messages: string[] = [];

  if (input.agent !== undefined && findResource(set, 'agent', input.agent) === undefined) {
    throw new Error(`Unknown agent '${input.agent}'. Run 'outfitter list agents' to see resolvable agents.`);
  }

  for (const kind of resolveKindFilter(input.kind)) {
    const hasAgentContext = input.agent !== undefined && kind === 'skill';
    const globalResources = listResources(set, kind);
    const localResources = hasAgentContext ? listAgentResources(set, input.agent, kind) : [];
    const resources = new Map(globalResources.map((resource) => [resource.slug, resource]));
    for (const resource of localResources) resources.set(resource.slug, resource);

    messages.push(`${pluralByKind.get(kind)!}${hasAgentContext ? ` (agent ${input.agent})` : ''}:`);
    messages.push(
      ...(resources.size === 0
        ? ['  (none)']
        : [...resources.values()]
            .sort((left, right) => compareSlugs(left.slug, right.slug))
            .map(
              (resource) =>
                `  ${resource.slug}  [${resource.winner.layer.label}${
                  resource.winner.ownerAgent === undefined ? '' : '; agent-local'
                }]`,
            )),
    );
  }

  return { messages };
};

export const createListCommand = (dependencies: ListCommandDependencies = {}): CommandObject => ({
  name: 'list',
  description: 'List resolvable resources (agents, skills, knowledge, commands).',
  register(program: Command): void {
    program.addCommand(
      new Command('list')
        .description('List resolvable resources (agents, skills, knowledge, commands).')
        .argument('[kind]', 'Restrict to one kind: agents, skills, knowledge, or commands.')
        .option('--agent <id>', 'Resolve resources in an agent context, including its local skills.')
        .action((kind: string | undefined, options: { agent?: string }) => {
          const result = executeListCommand({
            /* v8 ignore next 2 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
            homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
            projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
            kind,
            agent: options.agent,
          });

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
        }),
    );
  },
});
