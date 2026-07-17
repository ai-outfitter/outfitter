// Provides `outfitter list [kind]` over the effective resource set.
import { homedir } from 'node:os';

import { Command } from 'commander';

import type { ResourceKind } from '../../resolver/Resource.js';
import { listResources, resourceKinds } from '../../resolver/Resource.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
import type { CommandObject } from './CommandObject.js';

export interface ListInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly kind?: string;
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

  for (const kind of resolveKindFilter(input.kind)) {
    const resources = listResources(set, kind);
    messages.push(`${pluralByKind.get(kind)!}:`);
    messages.push(
      ...(resources.length === 0 ? ['  (none)'] : resources.map((r) => `  ${r.slug}  [${r.winner.layer.label}]`)),
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
        .action((kind: string | undefined) => {
          const result = executeListCommand({
            /* v8 ignore next 2 -- process defaults are exercised by the CLI entrypoint, not unit tests. */
            homeDirectory: dependencies.homeDirectory ?? homedir(),
            projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            kind,
          });

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
        }),
    );
  },
});
