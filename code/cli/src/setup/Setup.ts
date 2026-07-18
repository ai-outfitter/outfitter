// Interactive first-run onboarding: writes a starter `.agents` config (default agent + harness).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Harness } from '../settings/Settings.js';

/** A single choice offered by {@link SetupPrompter.select}. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The onboarding input boundary. Implementations return one of the offered option values (or the
 * supplied default) so the caller never has to re-validate answers. `interactive` is false when
 * there is no TTY, letting callers skip prompting and fall back to defaults.
 */
export interface SetupPrompter {
  readonly interactive: boolean;
  select(question: string, options: readonly SelectOption[], defaultValue: string): Promise<string>;
  input(question: string, defaultValue: string): Promise<string>;
}

export interface SetupInput {
  readonly homeDirectory: string;
  readonly prompter: SetupPrompter;
}

export interface SetupResult {
  /** Absolute paths written by this run, in write order (empty when already configured). */
  readonly created: readonly string[];
  readonly settingsPath: string;
  readonly defaultAgent?: string;
  readonly defaultHarness?: Harness;
  /** True when `settings.yml` already existed and nothing was written. */
  readonly alreadyConfigured: boolean;
  readonly messages: readonly string[];
}

const harnessOptions: readonly SelectOption[] = [
  { value: 'pi', label: 'pi — bundled with Outfitter, no separate install' },
  { value: 'claude', label: 'claude — Claude Code (installed separately)' },
];

const defaultAgentSlug = 'assistant';
const defaultHarness: Harness = 'pi';
const agentSlugPattern = /^[a-z0-9][a-z0-9-]*$/;

/** Coerces a free-text agent name into a valid directory slug, falling back to the default. */
export const sanitizeAgentSlug = (raw: string): string => {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return agentSlugPattern.test(slug) ? slug : defaultAgentSlug;
};

const asHarness = (value: string): Harness => (value === 'claude' ? 'claude' : 'pi');

const settingsYaml = (slug: string, harness: Harness): string =>
  `# Written by \`outfitter setup\`. Edit to change your defaults.\ndefault_agent: ${slug}\ndefault_harness: ${harness}\n`;

const agentMarkdown = (slug: string): string =>
  `---\nname: ${slug}\ndescription: Starter agent created by outfitter setup.\n---\n\n# ${slug}\n\n` +
  `You are a helpful coding agent. Edit \`~/.agents/agents/${slug}/agent.md\` to shape how this agent behaves,\n` +
  `and add skills under \`~/.agents/skills/\` then list them in this agent's frontmatter.\n`;

/**
 * Runs onboarding against `~/.agents`. If a `settings.yml` already exists it is left untouched and
 * `alreadyConfigured` is true. Otherwise it prompts for a harness and starter agent name (using
 * defaults for anything the prompter declines) and writes `settings.yml` plus the starter agent.
 */
export const executeSetup = async (input: SetupInput): Promise<SetupResult> => {
  const agentsDirectory = join(input.homeDirectory, '.agents');
  const settingsPath = join(agentsDirectory, 'settings.yml');

  if (existsSync(settingsPath)) {
    return {
      created: [],
      settingsPath,
      alreadyConfigured: true,
      messages: [`Outfitter is already set up at ${settingsPath}. Edit it, or run 'outfitter list agents'.`],
    };
  }

  const harness = asHarness(
    await input.prompter.select('Which harness should Outfitter launch by default?', harnessOptions, defaultHarness),
  );
  const agentSlug = sanitizeAgentSlug(await input.prompter.input('Name your starter agent', defaultAgentSlug));

  const agentPath = join(agentsDirectory, 'agents', agentSlug, 'agent.md');
  mkdirSync(join(agentsDirectory, 'agents', agentSlug), { recursive: true });
  writeFileSync(agentPath, agentMarkdown(agentSlug));
  writeFileSync(settingsPath, settingsYaml(agentSlug, harness));

  return {
    created: [settingsPath, agentPath],
    settingsPath,
    defaultAgent: agentSlug,
    defaultHarness: harness,
    alreadyConfigured: false,
    messages: [
      `Created ${settingsPath}`,
      `Created ${agentPath}`,
      `Default agent '${agentSlug}' will launch in ${harness}. Edit the files above to customize it.`,
    ],
  };
};
