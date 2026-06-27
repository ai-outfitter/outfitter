// Provides the command object for first-run Outfitter welcome onboarding.
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';

import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export type WelcomeDefaultProfileRoleId = 'founder' | 'engineer' | 'data_analyst';
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
  'Pi is a fully extensible agentic coding harness.',
  'Outfitter configures Pi with profiles and extensions — turning it into a complete agentic development environment.',
  'The founder profile brings Pi to feature parity with dedicated agentic coding tools:',
  'task tracking, multi-step reviews, browser automation, subagents, interactive shell, and MCP support.',
  'Press Y to install it now.',
] as const;

export const writeWelcomeIntro = (output: Pick<NodeJS.WritableStream, 'write'>): void => {
  output.write(`\n${welcomeIntroLines.join('\n')}\n`);
};

const defaultProfileRoleChoices: readonly WelcomeRoleChoice[] = [
  { id: 'founder', label: 'Founder' },
  { id: 'engineer', label: 'Engineer' },
  { id: 'data_analyst', label: 'Data Analyst' },
];

const fallbackRoleId: WelcomeDefaultProfileRoleId = 'founder';

const recommendedPiLoadout: WelcomeLoadout = {
  id: 'recommended-pi',
  label: 'Recommended Pi productivity loadout',
  items: [
    {
      id: 'deepwork',
      label: 'DeepWork',
      kind: 'extension',
      source: 'git:github.com/ai-outfitter/deepwork',
    },
    {
      id: 'rpiv-ask-user-question',
      label: 'Ask User Question',
      kind: 'package',
      source: 'npm:@juicesharp/rpiv-ask-user-question',
    },
    {
      id: 'ulta-tasklist',
      label: 'Ulta Tasklist',
      kind: 'extension',
      source: 'git:github.com/applepi-ai/ulta-tasklist',
    },
    {
      id: 'pi-nolo',
      label: 'Pi NOLO',
      kind: 'package',
      source: 'npm:pi-nolo',
    },
    {
      id: 'pi-browser-harness',
      label: 'Browser Harness',
      kind: 'package',
      source: 'npm:pi-browser-harness',
    },
    {
      id: 'pi-subagent',
      label: 'Pi Subagent',
      kind: 'package',
      source: 'npm:@mjakl/pi-subagent',
    },
    {
      id: 'pi-btw',
      label: 'Pi BTW',
      kind: 'package',
      source: 'npm:@narumitw/pi-btw',
    },
    {
      id: 'pi-must-have-extension',
      label: 'Must-Have Extension',
      kind: 'package',
      source: 'npm:pi-must-have-extension',
    },
    {
      id: 'pi-interactive-shell',
      label: 'Interactive Shell',
      kind: 'package',
      source: 'npm:pi-interactive-shell',
    },
    {
      id: 'pi-mcp-adapter',
      label: 'MCP Adapter',
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
      messages: [
        'Skipped default profile setup. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
      ],
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
    messages: buildWelcomeMessages(warnings),
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
    const answer = (await readline.question('Install the founder profile? [Y/n]: ')).trim().toLowerCase();
    const answerQuestions = answer === '' || ['y', 'yes'].includes(answer);

    if (!answerQuestions) {
      return { answerQuestions: false };
    }

    return { answerQuestions: true, selectedRoleId: 'founder' };
  } finally {
    readline.close();
  }
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

const buildWelcomeMessages = (warnings: readonly string[]): readonly string[] => [
  'Installed the founder profile. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
  ...warnings.map((warning) => `Warning: ${warning}`),
];

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
