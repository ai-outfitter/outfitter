// Interactive first-run onboarding: writes a starter `.agents` config (default agent + harness).
// Harness-neutral: this terminal flow is the default setup UX for every harness (pi, claude, and
// future adapters). A harness may layer its own in-session onboarding on top, but this is the
// baseline that works everywhere, generalizing the profile-era Pi-only `/outfitter` flow.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
const maxSlugLength = 64;
// Matches the persisted agent schema (agent.schema.json): single-hyphen-separated alphanumerics.
const agentSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Coerces a free-text agent name into a slug the agent schema accepts (lowercase, hyphen-separated
 * alphanumerics, no consecutive/edge hyphens, ≤ 64 chars), falling back to the default when nothing
 * usable remains — so the written agent's `name` always matches its directory and composes.
 */
export const sanitizeAgentSlug = (raw: string): string => {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics collapses to a single hyphen
    .replace(/^-+|-+$/g, '')
    .slice(0, maxSlugLength)
    .replace(/-+$/g, ''); // re-trim a hyphen left dangling by truncation

  return agentSlugPattern.test(slug) ? slug : defaultAgentSlug;
};

const asHarness = (value: string): Harness => (value === 'claude' ? 'claude' : 'pi');

// Quote the slug: bare YAML scalars like `123`, `true`, or `null` would parse as number/bool/null
// and fail string-typed schema validation, so onboarding output could not compose.
const settingsYaml = (slug: string, harness: Harness): string =>
  `# Written by \`outfitter setup\`. Edit to change your defaults.\ndefault_agent: "${slug}"\ndefault_harness: ${harness}\n`;

const agentMarkdown = (slug: string): string =>
  `---\nname: "${slug}"\ndescription: Starter agent created by outfitter setup.\n---\n\n# ${slug}\n\n` +
  `You are a helpful coding agent. Edit \`~/.agents/agents/${slug}/agent.md\` to shape how this agent behaves,\n` +
  `and add skills under \`~/.agents/skills/\` then list them in this agent's frontmatter.\n`;

const isFileExistsError = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'EEXIST';

/**
 * Runs onboarding against `~/.agents`. If a `settings.yml` already exists it is left untouched and
 * `alreadyConfigured` is true. Otherwise it prompts for a harness and starter agent name (using
 * defaults for anything the prompter declines) and writes `settings.yml` plus the starter agent.
 */
const alreadyConfiguredResult = (settingsPath: string): SetupResult => ({
  created: [],
  settingsPath,
  alreadyConfigured: true,
  messages: [`Outfitter is already set up at ${settingsPath}. Edit it, or run 'outfitter list agents'.`],
});

export const executeSetup = async (input: SetupInput): Promise<SetupResult> => {
  const agentsDirectory = join(input.homeDirectory, '.agents');
  const settingsPath = join(agentsDirectory, 'settings.yml');

  // Fast path: skip prompting entirely when clearly configured (the exclusive write below still
  // guards the check-then-write race).
  if (existsSync(settingsPath)) {
    return alreadyConfiguredResult(settingsPath);
  }

  const harness = asHarness(
    await input.prompter.select('Which harness should Outfitter launch by default?', harnessOptions, defaultHarness),
  );
  const agentSlug = sanitizeAgentSlug(await input.prompter.input('Name your starter agent', defaultAgentSlug));
  const agentPath = join(agentsDirectory, 'agents', agentSlug, 'agent.md');

  mkdirSync(agentsDirectory, { recursive: true });

  // Exclusive create: settings.yml is written first (write order) and never clobbered, even if it
  // appears between the check above and this write.
  try {
    writeFileSync(settingsPath, settingsYaml(agentSlug, harness), { flag: 'wx' });
  } catch (error) {
    /* v8 ignore next 3 -- races the existsSync check above; only reachable under concurrent setup. */
    if (isFileExistsError(error)) {
      return alreadyConfiguredResult(settingsPath);
    }
    throw error;
  }

  // Exclusive create for the starter agent too; on conflict, roll back the settings.yml we created
  // so a pre-existing agent is never destroyed and no half-configured state is left behind.
  try {
    mkdirSync(join(agentsDirectory, 'agents', agentSlug), { recursive: true });
    writeFileSync(agentPath, agentMarkdown(agentSlug), { flag: 'wx' });
  } catch (error) {
    rmSync(settingsPath, { force: true });

    if (isFileExistsError(error)) {
      return {
        created: [],
        settingsPath,
        alreadyConfigured: false,
        messages: [`An agent already exists at ${agentPath}. Re-run 'outfitter setup' and choose a different name.`],
      };
    }

    throw error;
  }

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
