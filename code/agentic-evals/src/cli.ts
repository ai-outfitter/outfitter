#!/usr/bin/env node
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listEvalDirectories, loadEvalDefinition } from './loadEval.ts';
import { runEval } from './runner.ts';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `Usage:
  agentic-evals list
  agentic-evals run <eval-id> [--variant <id>] [--repeat <n>] [--keep-workspace]
                              [--evals-dir <path>] [--results-dir <path>]
                              [--agent pi|claude|mock] [--mock-command <cmd>]

--agent overrides the eval's adapter; --agent mock with --mock-command runs an
arbitrary command in place of the agent (useful for validating an eval's
fixtures and grading with a reference solution).

Runs the eval's workflow through its profile (via outfitter/pi, claude, or a
mock adapter), grades the declared outputs, checks, and questions, and writes
JSON results under results/<eval-id>/<timestamp>/.`;

interface CliOptions {
  variant?: string;
  repeat?: number;
  keepWorkspace: boolean;
  evalsDir: string;
  resultsDir: string;
  agent?: 'pi' | 'claude' | 'mock';
  mockCommand?: string;
}

const parseOptions = (argv: readonly string[]): { positional: string[]; options: CliOptions } => {
  const positional: string[] = [];
  const options: CliOptions = {
    keepWorkspace: false,
    evalsDir: join(packageRoot, 'evals'),
    resultsDir: join(packageRoot, 'results'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] as string;
    const next = (): string => {
      index += 1;
      const value = argv[index];
      if (value === undefined) {
        throw new Error(`${argument} requires a value`);
      }
      return value;
    };
    if (argument === '--variant') {
      options.variant = next();
    } else if (argument === '--repeat') {
      const value = Number(next());
      if (!Number.isInteger(value) || value < 1) {
        throw new Error('--repeat must be a positive integer');
      }
      options.repeat = value;
    } else if (argument === '--keep-workspace') {
      options.keepWorkspace = true;
    } else if (argument === '--agent') {
      const value = next();
      if (value !== 'pi' && value !== 'claude' && value !== 'mock') {
        throw new Error('--agent must be pi, claude, or mock');
      }
      options.agent = value;
    } else if (argument === '--mock-command') {
      options.mockCommand = next();
    } else if (argument === '--evals-dir') {
      options.evalsDir = resolve(next());
    } else if (argument === '--results-dir') {
      options.resultsDir = resolve(next());
    } else if (argument.startsWith('--')) {
      throw new Error(`unknown option ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  return { positional, options };
};

const listCommand = async (options: CliOptions): Promise<number> => {
  const directories = await listEvalDirectories(options.evalsDir);
  for (const directory of directories) {
    const definition = await loadEvalDefinition(directory);
    const variants = definition.matrix?.variants.map((variant) => variant.id).join(', ') ?? 'default';
    console.log(`${definition.id}  profile=${definition.profile} agent=${definition.agent} variants=[${variants}]`);
  }
  if (directories.length === 0) {
    console.log(`no evals found in ${options.evalsDir}`);
  }
  return 0;
};

const runCommand = async (evalId: string, options: CliOptions): Promise<number> => {
  const directories = await listEvalDirectories(options.evalsDir);
  const directory = directories.find((candidate) => basename(candidate) === evalId);
  if (directory === undefined) {
    console.error(`unknown eval "${evalId}" — run "agentic-evals list" to see available evals`);
    return 1;
  }
  let definition = await loadEvalDefinition(directory);
  if (options.agent !== undefined) {
    definition = {
      ...definition,
      agent: options.agent,
      launcher: options.agent === 'mock' ? 'direct' : definition.launcher,
      mock: options.mockCommand === undefined ? definition.mock : { command: options.mockCommand },
    };
  }
  const outcome = await runEval(definition, {
    resultsRoot: options.resultsDir,
    variantFilter: options.variant,
    repeatOverride: options.repeat,
    keepWorkspaces: options.keepWorkspace,
    log: (message) => {
      console.log(message);
    },
  });
  console.log(`\nresults: ${outcome.resultsDirectory}`);
  for (const variant of outcome.summary.variants) {
    console.log(
      `  ${variant.variant}: ${String(variant.passed)}/${String(variant.runs)} passed (mean ${String(variant.mean_wall_time_seconds)}s)`,
    );
  }
  return outcome.summary.passed ? 0 : 1;
};

const main = async (): Promise<number> => {
  const { positional, options } = parseOptions(process.argv.slice(2));
  const [command, evalId] = positional;
  if (command === 'list') {
    return listCommand(options);
  }
  if (command === 'run' && evalId !== undefined) {
    return runCommand(evalId, options);
  }
  console.error(USAGE);
  return command === undefined ? 0 : 1;
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
