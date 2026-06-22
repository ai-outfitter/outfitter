// Provides the command object for first-run Outfitter welcome onboarding.
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';

import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export type WelcomeDefaultProfileRoleId = 'engineer' | 'data_analyst';
export type WelcomeLoadoutItemKind = 'extension' | 'package';

export interface WelcomeCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}

export interface WelcomeRoleChoice {
  readonly id: WelcomeDefaultProfileRoleId;
  readonly label: string;
}

export interface WelcomeLoadoutItem {
  readonly id: string;
  readonly label: string;
  readonly kind: WelcomeLoadoutItemKind;
  readonly source: string;
}

export interface WelcomeLoadout {
  readonly id: string;
  readonly label: string;
  readonly items: readonly WelcomeLoadoutItem[];
}

export interface WelcomeLoadoutSelection {
  readonly id: string;
  readonly label: string;
  readonly selectedItems: readonly WelcomeLoadoutItem[];
}

export interface WelcomePlan {
  readonly answerQuestions: boolean;
  readonly selectedRoleId?: string;
  readonly loadoutItemIds?: readonly string[];
}

export interface WelcomeCommandResult {
  readonly answered: boolean;
  readonly selectedRole?: WelcomeRoleChoice;
  readonly selectedLoadout?: WelcomeLoadoutSelection;
  readonly warnings: readonly string[];
  readonly messages: readonly string[];
}

export interface WelcomeCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly input?: { readonly isTTY?: boolean } & NodeJS.ReadableStream;
  readonly output?: { readonly isTTY?: boolean } & NodeJS.WritableStream;
  readonly interactive?: boolean;
  readonly writeLine?: (message: string) => void;
  readonly selectWelcomePlan?: (input: WelcomeCommandInput) => Promise<WelcomePlan>;
}

const welcomeIntroLines = [
  String.raw`  ____        _    __ _ _   _            `,
  String.raw` / __ \      | |  / _(_) | | |           `,
  String.raw`| |  | |_   _| |_| |_ _| |_| |_ ___ _ __ `,
  String.raw`| |  | | | | | __|  _| | __| __/ _ \ '__|`,
  String.raw`| |__| | |_| | |_| | | | |_| ||  __/ |   `,
  String.raw` \____/ \__,_|\__|_| |_|\__|\__\___|_|   `,
  '',
  'Welcome to Outfitter.',
  'Pi is a heavily customizable coding harness. The next few questions will configure Outfitter to best suit your workflow.',
] as const;

export const writeWelcomeIntro = (output: Pick<NodeJS.WritableStream, 'write'>): void => {
  output.write(`\n${welcomeIntroLines.join('\n')}\n`);
};

const defaultProfileRoleChoices: readonly WelcomeRoleChoice[] = [
  { id: 'engineer', label: 'Engineer' },
  { id: 'data_analyst', label: 'Data Analyst' },
];

const fallbackRoleId: WelcomeDefaultProfileRoleId = 'engineer';

const recommendedPiLoadout: WelcomeLoadout = {
  id: 'recommended-pi',
  label: 'Recommended Pi productivity loadout',
  items: [
    {
      id: 'ulta-tasklist',
      label: 'Ulta Tasklist',
      kind: 'extension',
      source: 'git:github.com/ai-outfitter/ulta-tasklist',
    },
    {
      id: 'deepwork',
      label: 'DeepWork',
      kind: 'extension',
      source: 'git:github.com/ai-outfitter/deepwork',
    },
    {
      id: 'pi-subagents',
      label: 'Pi Subagents',
      kind: 'package',
      source: 'npm:pi-subagents',
    },
    {
      id: 'pi-mcp-adapter',
      label: 'Pi MCP Adapter',
      kind: 'package',
      source: 'npm:pi-mcp-adapter',
    },
  ],
};

export const executeWelcomeCommand = async (
  input: WelcomeCommandInput,
  dependencies: WelcomeCommandDependencies = {},
): Promise<WelcomeCommandResult> => {
  requireInteractiveTerminalIfNeeded(dependencies);
  const plan = await selectWelcomePlan(input, dependencies);

  if (!plan.answerQuestions) {
    return {
      answered: false,
      warnings: [],
      messages: ['Skipped Outfitter welcome questions. Run `outfitter welcome` any time to revisit them.'],
    };
  }

  const roleResolution = resolveSelectedRole(plan.selectedRoleId);
  const loadoutResolution = resolveSelectedLoadout(plan.loadoutItemIds);
  const warnings = [...roleResolution.warnings, ...loadoutResolution.warnings];

  return {
    answered: true,
    selectedRole: roleResolution.role,
    selectedLoadout: loadoutResolution.loadout,
    warnings,
    messages: buildWelcomeMessages(roleResolution.role, loadoutResolution.loadout, warnings),
  };
};

export const createWelcomeCommand = (dependencies: WelcomeCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'welcome',
    description: 'Run Outfitter welcome onboarding prompts.',
    register(program: Command): void {
      program
        .command(command.name)
        .description(command.description)
        .action(async () => {
          const result = await executeWelcomeCommand(
            {
              /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
              homeDirectory: dependencies.homeDirectory ?? homedir(),
              /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
              projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            },
            { ...dependencies, interactive: true },
          );

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
        });
    },
  };

  return command;
};

const selectWelcomePlan = async (
  input: WelcomeCommandInput,
  dependencies: WelcomeCommandDependencies,
): Promise<WelcomePlan> => {
  if (dependencies.selectWelcomePlan !== undefined) {
    return dependencies.selectWelcomePlan(input);
  }

  return promptForWelcomePlan(dependencies);
};

const promptForWelcomePlan = async (dependencies: WelcomeCommandDependencies): Promise<WelcomePlan> => {
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const output = dependencies.output ?? process.stdout;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({ input: dependencies.input ?? process.stdin, output });

  try {
    writeWelcomeIntro(output);
    const answerQuestions = await promptForYesNo(
      readline,
      'Choose a role and recommended Pi loadout now? [Y/n]: ',
      true,
    );

    if (!answerQuestions) {
      return { answerQuestions: false };
    }

    const selectedRoleId = await promptForRole(readline, output);
    const loadoutItemIds = await promptForLoadout(readline, output);

    return { answerQuestions: true, selectedRoleId, loadoutItemIds };
  } finally {
    readline.close();
  }
};

const promptForYesNo = async (
  readline: { question(query: string): Promise<string> },
  query: string,
  defaultValue: boolean,
): Promise<boolean> => {
  const answer = (await readline.question(query)).trim().toLowerCase();

  if (answer === '') {
    return defaultValue;
  }

  return ['y', 'yes'].includes(answer);
};

const promptForRole = async (
  readline: { question(query: string): Promise<string> },
  output: NodeJS.WritableStream,
): Promise<string> => {
  output.write('\nChoose your initial Outfitter role/profile:\n');
  defaultProfileRoleChoices.forEach((role, index) => output.write(`${index + 1}. ${role.id} - ${role.label}\n`));

  return defaultProfileRoleChoices[await promptForSelectionIndex(readline, 'Role [1]: ', 0)]?.id ?? fallbackRoleId;
};

const promptForLoadout = async (
  readline: { question(query: string): Promise<string> },
  output: NodeJS.WritableStream,
): Promise<readonly string[]> => {
  output.write(`\n${recommendedPiLoadout.label}:\n`);
  recommendedPiLoadout.items.forEach((item, index) => {
    output.write(`${index + 1}. ${item.label} (${item.kind}) - ${item.source}\n`);
  });

  const mode = (await readline.question('Install recommended loadout? [Y=all/c=choose/n=skip]: ')).trim().toLowerCase();

  if (['n', 'no', 'skip'].includes(mode)) {
    return [];
  }

  if (!['c', 'choose', 'custom', 's', 'select'].includes(mode)) {
    return recommendedPiLoadout.items.map((item) => item.id);
  }

  const answer = (await readline.question('Loadout items [1,2,3,4 or blank for all]: ')).trim();

  if (answer === '') {
    return recommendedPiLoadout.items.map((item) => item.id);
  }

  return answer
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10) - 1)
    .filter((index) => index >= 0 && index < recommendedPiLoadout.items.length)
    .map((index) => recommendedPiLoadout.items[index].id);
};

const promptForSelectionIndex = async (
  readline: { question(query: string): Promise<string> },
  query: string,
  defaultIndex: number,
): Promise<number> => {
  const answer = (await readline.question(query)).trim();

  if (answer === '') {
    return defaultIndex;
  }

  return Math.max(Number.parseInt(answer, 10) - 1, 0);
};

const resolveSelectedRole = (
  selectedRoleId: string | undefined,
): { readonly role: WelcomeRoleChoice; readonly warnings: readonly string[] } => {
  const roleId = selectedRoleId ?? fallbackRoleId;
  const selectedRole = defaultProfileRoleChoices.find((role) => role.id === roleId);

  if (selectedRole !== undefined) {
    return { role: selectedRole, warnings: [] };
  }

  return {
    role: defaultProfileRoleChoices.find((role) => role.id === fallbackRoleId)!,
    warnings: [`Welcome role '${roleId}' is not available; using fallback role '${fallbackRoleId}'.`],
  };
};

const resolveSelectedLoadout = (
  loadoutItemIds: readonly string[] | undefined,
): { readonly loadout: WelcomeLoadoutSelection; readonly warnings: readonly string[] } => {
  const selectedItemIds = loadoutItemIds ?? recommendedPiLoadout.items.map((item) => item.id);
  const availableItems = new Map(recommendedPiLoadout.items.map((item) => [item.id, item]));
  const selectedItems: WelcomeLoadoutItem[] = [];
  const warnings: string[] = [];

  for (const itemId of selectedItemIds) {
    const item = availableItems.get(itemId);

    if (item === undefined) {
      warnings.push(`Loadout item '${itemId}' is not available for ${recommendedPiLoadout.id}; skipping it.`);
      continue;
    }

    if (selectedItems.every((selectedItem) => selectedItem.id !== item.id)) {
      selectedItems.push(item);
    }
  }

  return {
    loadout: { id: recommendedPiLoadout.id, label: recommendedPiLoadout.label, selectedItems },
    warnings,
  };
};

const buildWelcomeMessages = (
  selectedRole: WelcomeRoleChoice,
  selectedLoadout: WelcomeLoadoutSelection,
  warnings: readonly string[],
): readonly string[] => {
  const loadoutMessage =
    selectedLoadout.selectedItems.length === 0
      ? `Skipped ${selectedLoadout.label}.`
      : `Selected ${selectedLoadout.label}: ${selectedLoadout.selectedItems.map((item) => item.source).join(', ')}.`;

  return [
    `Selected Outfitter role: ${selectedRole.id} (${selectedRole.label}).`,
    loadoutMessage,
    ...warnings.map((warning) => `Warning: ${warning}`),
  ];
};

const requireInteractiveTerminalIfNeeded = (dependencies: WelcomeCommandDependencies): void => {
  if (dependencies.interactive !== true) {
    return;
  }

  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const inputIsTty = (dependencies.input ?? process.stdin).isTTY === true;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const outputIsTty = (dependencies.output ?? process.stdout).isTTY === true;

  if (!inputIsTty || !outputIsTty) {
    throw new Error('`outfitter welcome` requires an interactive TTY on both stdin and stdout.');
  }
};
