// Handles the exit-time composite profile state-write diff for a run: formatting issues,
// prompting for state_persistence 'prompt' paths, and recording always-persist choices.
import { createInterface } from 'node:readline/promises';

import type { AgentAdapter } from '../../../agents/AgentAdapter.js';
import {
  detectCompositeProfileStateWrites,
  persistCompositeProfileStateWrite,
  recordProfileStatePersistenceOverride,
} from '../../../compositeProfile/StatePersistence.js';
import type {
  CompositeProfileStateBaseline,
  CompositeProfileStatePath,
  CompositeProfileStateWriteIssue,
  CompositeProfileStateWritePrompt,
} from '../../../compositeProfile/StatePersistence.js';
import { isInteractiveRunLaunch } from './FirstRunOnboarding.js';
import type { ResolvedRunProfile } from './RunProfileResolution.js';
import type { RunCommandDependencies } from '../RunCommand.js';

export interface CompositeProfileStateWriteHandlingInput {
  readonly adapterId: string;
  readonly rootDirectory: string;
  readonly statePaths: readonly CompositeProfileStatePath[];
  readonly stateBaseline: CompositeProfileStateBaseline;
  readonly prompt?: CompositeProfileStateWritePrompt;
  readonly recordAlwaysChoice: (relativePath: string) => string | undefined;
  readonly notify: (message: string) => void;
}

export const handleCompositeProfileStateWrites = async (
  input: CompositeProfileStateWriteHandlingInput,
): Promise<readonly string[]> => {
  const warnings: string[] = [];

  for (const issue of detectCompositeProfileStateWrites(input.rootDirectory, input.statePaths, input.stateBaseline)) {
    if (issue.strategy === 'error') {
      throw new Error(formatCompositeProfileStateWriteIssue(input.adapterId, issue));
    }

    if (issue.strategy === 'prompt') {
      warnings.push(...(await handlePromptStateWriteIssue(input, issue)));
      continue;
    }

    warnings.push(formatCompositeProfileStateWriteIssue(input.adapterId, issue));
  }

  return warnings;
};

const handlePromptStateWriteIssue = async (
  input: CompositeProfileStateWriteHandlingInput,
  issue: CompositeProfileStateWriteIssue,
): Promise<readonly string[]> => {
  if (issue.unknown) {
    return [
      formatCompositeProfileStateWriteIssue(input.adapterId, issue),
      `state_persistence 'prompt' cannot persist undeclared writes; '${issue.relativePath}' was reported instead.`,
    ];
  }

  if (input.prompt === undefined) {
    return [
      formatCompositeProfileStateWriteIssue(input.adapterId, issue),
      `state_persistence prompt for '${issue.relativePath}' skipped: non-interactive session.`,
    ];
  }

  const statePath = findDeclaredStatePath(input.statePaths, issue.relativePath);
  const choice = await input.prompt({
    agentId: input.adapterId,
    relativePath: issue.relativePath,
    sourcePath: statePath.sourcePath,
  });

  return applyPromptStateWriteChoice(input, statePath, choice);
};

const applyPromptStateWriteChoice = (
  input: CompositeProfileStateWriteHandlingInput,
  statePath: CompositeProfileStatePath,
  choice: 'persist' | 'discard' | 'always',
): readonly string[] => {
  if (choice === 'discard') {
    input.notify(`Discarded ${input.adapterId} state write to '${statePath.relativePath}'.`);
    return [];
  }

  try {
    persistCompositeProfileStateWrite(input.rootDirectory, statePath);
  } catch (error) {
    return [`Could not persist state path '${statePath.relativePath}': ${String(error)}`];
  }

  input.notify(`Persisted ${input.adapterId} state write '${statePath.relativePath}' to ${statePath.sourcePath}.`);

  if (choice === 'always') {
    const warning = input.recordAlwaysChoice(statePath.relativePath);
    return warning === undefined ? [] : [warning];
  }

  return [];
};

const findDeclaredStatePath = (
  statePaths: readonly CompositeProfileStatePath[],
  relativePath: string,
): CompositeProfileStatePath => {
  const statePath = statePaths.find((candidate) => candidate.relativePath === relativePath);

  /* v8 ignore next 3 -- declared prompt issues always originate from a declared state path. */
  if (statePath === undefined) {
    throw new Error(`State path '${relativePath}' is not declared by the composite profile.`);
  }

  return statePath;
};

// The "always" choice is recorded in the selected profile's own YAML file because profiles
// are the single source of truth for state_persistence policy; a parallel settings-layer
// override would create a second precedence system that adapter validation cannot see.
// Remote/cached profiles are never mutated, so the choice degrades to a one-run persist
// with an actionable warning.
export const recordAlwaysStatePersistenceChoice = (
  adapter: AgentAdapter,
  resolvedProfile: ResolvedRunProfile,
  relativePath: string,
): string | undefined => {
  const declaration = adapter.statePaths?.[relativePath];

  if (declaration === undefined || !declaration.allowedStrategies.includes('symlink')) {
    return (
      `Cannot always-persist '${relativePath}': the ${adapter.id} adapter does not allow 'symlink' for it; ` +
      `the write was persisted once.`
    );
  }

  const selectedLayer = [...resolvedProfile.profileLayers]
    .reverse()
    .find((layer) => layer.profile.id === resolvedProfile.profile.id);

  if (
    selectedLayer === undefined ||
    selectedLayer.source.uri !== undefined ||
    selectedLayer.source.github !== undefined
  ) {
    return (
      `Cannot record the always-persist choice for '${relativePath}' because profile ` +
      `'${resolvedProfile.profile.id}' is not a local profile file; the write was persisted once.`
    );
  }

  recordProfileStatePersistenceOverride(selectedLayer.profilePath, relativePath, 'symlink');
  return undefined;
};

export const resolveStateWritePrompt = (
  dependencies: RunCommandDependencies,
): CompositeProfileStateWritePrompt | undefined => {
  if (!isInteractiveRunLaunch(dependencies)) {
    return undefined;
  }

  return (
    dependencies.promptStateWritePersistence ??
    /* v8 ignore next -- terminal prompting is direct CLI behavior; tests inject a prompt. */
    createTerminalStateWritePrompt(dependencies.input ?? process.stdin, dependencies.output ?? process.stdout)
  );
};

/* v8 ignore start -- readline prompting is direct terminal behavior; tests inject a prompt. */
const createTerminalStateWritePrompt =
  (input: NodeJS.ReadableStream, output: NodeJS.WritableStream): CompositeProfileStateWritePrompt =>
  async (request) => {
    const readline = createInterface({ input, output });

    try {
      for (;;) {
        const answer = (
          await readline.question(
            `${request.agentId} wrote state path '${request.relativePath}' (state_persistence 'prompt'). ` +
              `[p]ersist to ${request.sourcePath ?? 'its durable source'} / [d]iscard / ` +
              `[a]lways persist for this profile: `,
          )
        )
          .trim()
          .toLowerCase();

        if (answer === 'p' || answer === 'persist') {
          return 'persist';
        }

        if (answer === 'd' || answer === 'discard') {
          return 'discard';
        }

        if (answer === 'a' || answer === 'always') {
          return 'always';
        }
      }
    } finally {
      readline.close();
    }
  };
/* v8 ignore stop */

const formatCompositeProfileStateWriteIssue = (adapterId: string, issue: CompositeProfileStateWriteIssue): string => {
  if (issue.unknown) {
    return `${adapterId} wrote undeclared composite profile state '${issue.relativePath}' and it was not persisted.`;
  }

  if (issue.strategy === 'symlink') {
    return `${adapterId} replaced symlinked state path '${issue.relativePath}' and the change was not persisted.`;
  }

  return `${adapterId} wrote '${issue.relativePath}' with state_persistence '${issue.strategy}' and it was not persisted.`;
};
