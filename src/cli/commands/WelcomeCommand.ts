// Provides the command object for first-run Outfitter welcome onboarding.
import { createInterface } from 'node:readline/promises';
import { homedir } from 'node:os';

import type { Command } from 'commander';

import type { CommandObject } from './CommandObject.js';

export type WelcomeDefaultProfileRoleId = string;
export type WelcomeLoadoutItemKind = 'extension' | 'package';

export interface WelcomeProfileChoice {
  readonly id: string;
  readonly label?: string;
  readonly description?: string;
}

export type WelcomeRoleChoice = WelcomeProfileChoice;

export interface WelcomeCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly profileChoices?: readonly WelcomeProfileChoice[];
  readonly currentDefaultProfileId?: string;
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
  readonly selectedProfileId?: string;
  /** @deprecated use selectedProfileId. Kept for compatibility with injected test/runtime selectors. */
  readonly selectedRoleId?: string;
  readonly loadoutItemIds?: readonly string[];
}

export interface WelcomeCommandResult {
  readonly answered: boolean;
  readonly selectedProfile?: WelcomeProfileChoice;
  /** @deprecated use selectedProfile. */
  readonly selectedRole?: WelcomeProfileChoice;
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

export const defaultSharedProfilesSourceUrl = 'https://github.com/ai-outfitter/default-profiles';

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
  'Outfitter configures Pi with shared profiles and extensions — turning it into a complete agentic development environment.',
  '',
  `Outfitter can start you from shared profiles at ${defaultSharedProfilesSourceUrl}.`,
  'First-run shared setup is recorded as:',
  'remote_settings:',
  '  - github: ai-outfitter/default-profiles',
  '    ref: main',
  '    path: settings.yml',
  'Choose a profile now if shared profiles are available; otherwise Outfitter will open /outfitter inside Pi.',
] as const;

export const writeWelcomeIntro = (output: Pick<NodeJS.WritableStream, 'write'>): void => {
  output.write(`\n${welcomeIntroLines.join('\n')}\n`);
};

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
        'Skipped shared profile setup. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
      ],
    };
  }

  const profileResolution = resolveSelectedProfile(
    plan.selectedProfileId ?? plan.selectedRoleId,
    input.profileChoices ?? [],
    input.currentDefaultProfileId,
  );
  const loadoutResolution = resolveSelectedLoadout(plan.loadoutItemIds);
  const warnings = [...profileResolution.warnings, ...loadoutResolution.warnings];

  return {
    answered: true,
    selectedProfile: profileResolution.profile,
    selectedRole: profileResolution.profile,
    selectedLoadout: loadoutResolution.loadout,
    warnings,
    messages: buildWelcomeMessages(profileResolution.profile, warnings),
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

  return promptForWelcomePlan(input, dependencies);
};

const promptForWelcomePlan = async (
  input: WelcomeCommandInput,
  dependencies: WelcomeCommandDependencies,
): Promise<WelcomePlan> => {
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const output = dependencies.output ?? process.stdout;
  /* v8 ignore next -- default process streams are direct terminal behavior; tests inject streams. */
  const readline = createInterface({ input: dependencies.input ?? process.stdin, output });

  try {
    writeWelcomeIntro(output);
    const selectedProfileId = await promptForWelcomeProfileWithReadline(readline, output, input);

    if (selectedProfileId === undefined) {
      return { answerQuestions: false };
    }

    return { answerQuestions: true, selectedProfileId };
  } finally {
    readline.close();
  }
};

const promptForWelcomeProfileWithReadline = async (
  readline: { question(query: string): Promise<string> },
  output: Pick<NodeJS.WritableStream, 'write'>,
  input: WelcomeCommandInput,
): Promise<string | undefined> => {
  const profiles = input.profileChoices ?? [];

  if (profiles.length === 0) {
    output.write('\nNo shared default profiles were found. Outfitter will open /outfitter inside Pi instead.\n');
    return undefined;
  }

  const defaultIndex = Math.max(
    profiles.findIndex((profile) => profile.id === input.currentDefaultProfileId),
    0,
  );
  output.write('\nChoose your default shared profile:\n');
  profiles.forEach((profile, index) => {
    output.write(`${index + 1}. ${formatProfileChoiceTitle(profile)}\n`);
    if (profile.description !== undefined) {
      output.write(`   ${profile.description}\n`);
    }
  });

  const answer = await readline.question(`Default profile [${defaultIndex + 1}]: `);
  const selectedIndex = Number.parseInt(answer.trim() || String(defaultIndex + 1), 10) - 1;
  const selectedProfile = profiles[selectedIndex];

  if (selectedProfile === undefined) {
    throw new Error('Selected shared profile number is out of range.');
  }

  return selectedProfile.id;
};

const formatProfileChoiceTitle = (profile: WelcomeProfileChoice): string => {
  if (profile.label === undefined || profile.label === profile.id) {
    return profile.id;
  }

  return `${profile.id} - ${profile.label}`;
};

const resolveSelectedProfile = (
  selectedProfileId: string | undefined,
  profileChoices: readonly WelcomeProfileChoice[],
  currentDefaultProfileId: string | undefined,
): { readonly profile: WelcomeProfileChoice; readonly warnings: readonly string[] } => {
  const fallbackProfile = selectFallbackProfile(profileChoices, currentDefaultProfileId, selectedProfileId);
  const profileId = selectedProfileId ?? fallbackProfile.id;
  const selectedProfile = profileChoices.find((profile) => profile.id === profileId);

  if (selectedProfile !== undefined) {
    return { profile: selectedProfile, warnings: [] };
  }

  if (profileChoices.length === 0) {
    return { profile: fallbackProfile, warnings: [] };
  }

  return {
    profile: fallbackProfile,
    warnings: [`Welcome profile '${profileId}' is not available; using fallback profile '${fallbackProfile.id}'.`],
  };
};

const selectFallbackProfile = (
  profileChoices: readonly WelcomeProfileChoice[],
  currentDefaultProfileId: string | undefined,
  selectedProfileId: string | undefined,
): WelcomeProfileChoice => {
  const currentDefaultProfile = profileChoices.find((profile) => profile.id === currentDefaultProfileId);

  if (currentDefaultProfile !== undefined) {
    return currentDefaultProfile;
  }

  return profileChoices[0] ?? { id: currentDefaultProfileId ?? selectedProfileId ?? 'default' };
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
  selectedProfile: WelcomeProfileChoice,
  warnings: readonly string[],
): readonly string[] => [
  `Selected default profile '${selectedProfile.id}' from shared profiles. Use /outfitter inside Pi or run \`outfitter profile list\` to manage profiles.`,
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
