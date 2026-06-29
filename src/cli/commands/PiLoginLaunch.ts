/* eslint-disable max-lines */
// Prepares Pi launch-time bootstrap extensions for Outfitter UX, login, and setup handoffs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createDefaultSettingsContent as createSetupDefaultSettingsContent } from './SetupCommand.js';

export interface PiRuntimeOnboardingLaunchInput {
  readonly autoOpenOutfitter?: boolean;
  readonly defaultProfilesPath?: string;
}

export interface PiLoginLaunchPlanInput {
  readonly adapterId: string;
  readonly homeDirectory: string;
  readonly launchPlan: AgentLaunchPlan;
  readonly runtimeOnboarding?: PiRuntimeOnboardingLaunchInput;
  readonly writeLine?: (message: string) => void;
}

const outfitterCommandMessage =
  'Outfitter will open `/outfitter` inside Pi so you can choose the default profile for future launches.';

const runtimeLoginMessage =
  'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.';

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--export', '--list-models']);
const nonInteractivePiModes = new Set(['json', 'print', 'rpc']);

export const preparePiLoginLaunchPlan = (input: PiLoginLaunchPlanInput): AgentLaunchPlan => {
  if (input.adapterId !== 'pi') {
    return input.launchPlan;
  }

  // Load the Outfitter runtime extension for every interactive pi session. It brands the
  // startup header, owns Outfitter-specific shortcuts, and registers native /outfitter
  // onboarding after pi has started. Non-interactive launches (--print, --export, …) keep
  // pi untouched and must not prompt, auto-submit commands, or mutate user settings.
  let launchPlan = input.launchPlan;
  const piConfigDirectory = input.launchPlan.env.PI_CODING_AGENT_DIR ?? join(input.homeDirectory, '.pi', 'agent');
  const interactiveLaunch = !isNonInteractivePiLaunch(input.launchPlan.args);

  if (!interactiveLaunch) {
    return launchPlan;
  }

  launchPlan = addExtension(
    launchPlan,
    piConfigDirectory,
    'outfitter-extension.js',
    createPiOutfitterExtensionContent({
      autoOpenOutfitter: input.runtimeOnboarding?.autoOpenOutfitter === true,
      defaultProfilesPath: input.runtimeOnboarding?.defaultProfilesPath,
      homeDirectory: input.homeDirectory,
    }),
  );

  if (input.runtimeOnboarding?.autoOpenOutfitter === true) {
    writePiLaunchMessage(input.writeLine, outfitterCommandMessage);
  }

  if (!hasConfiguredPiLoginState(piConfigDirectory)) {
    writePiLaunchMessage(input.writeLine, runtimeLoginMessage);
  }

  return launchPlan;
};

const addExtension = (
  launchPlan: AgentLaunchPlan,
  piConfigDirectory: string,
  fileName: string,
  content: string,
): AgentLaunchPlan => {
  const extensionPath = join(piConfigDirectory, 'outfitter', fileName);
  mkdirSync(dirname(extensionPath), { recursive: true });
  writeFileSync(extensionPath, content);

  return {
    ...launchPlan,
    args: ['--extension', extensionPath, ...launchPlan.args],
    env: { ...launchPlan.env, PI_CODING_AGENT_DIR: piConfigDirectory },
  };
};

// The general Outfitter pi extension. It brands the startup header, owns
// Outfitter-specific interactive shortcuts, registers native /outfitter, and
// keeps credential entry delegated to Pi's native /login command.
const createPiOutfitterExtensionContent = (input: {
  readonly autoOpenOutfitter: boolean;
  readonly defaultProfilesPath?: string;
  readonly homeDirectory: string;
}): string => {
  const defaultSettingsTemplate = createSetupDefaultSettingsContent('__OUTFITTER_PROFILE_ID__');

  return String.raw`import { matchesKey } from "@earendil-works/pi-tui";

const OUTFITTER_PLAN_TOOLS = ["read", "grep", "find", "ls"];
const OUTFITTER_DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const OUTFITTER_HOME = ${JSON.stringify(input.homeDirectory)};
const OUTFITTER_DEFAULT_PROFILES_PATH = ${JSON.stringify(input.defaultProfilesPath)};
const OUTFITTER_AUTO_OPEN = ${JSON.stringify(input.autoOpenOutfitter)};
const OUTFITTER_DEFAULT_SETTINGS_TEMPLATE = ${JSON.stringify(defaultSettingsTemplate)};
const OUTFITTER_STANDARD_PROFILE_ORDER = ["founder", "engineer", "data_analyst"];
const OUTFITTER_STANDARD_PROFILES = [
  {
    id: "founder",
    label: "Founder",
    description: "Founder-operator setup for building, product thinking, research checks, dense prose, and careful delivery.",
  },
  {
    id: "engineer",
    label: "Engineer",
    description: "Engineering setup for repository navigation, maintainable code changes, tests, and reviews.",
  },
  {
    id: "data_analyst",
    label: "Data Analyst",
    description: "Data analysis setup for careful inspection, reproducible methods, assumptions, and summaries.",
  },
];
const OUTFITTER_RECOMMENDED_LOADOUT = [
  "git:github.com/ai-outfitter/deepwork",
  "npm:@juicesharp/rpiv-ask-user-question",
  "git:github.com/applepi-ai/ulta-tasklist",
  "npm:pi-nolo",
  "npm:pi-browser-harness",
  "npm:@mjakl/pi-subagent",
  "npm:@narumitw/pi-btw",
  "npm:pi-must-have-extension",
  "npm:pi-interactive-shell",
  "npm:pi-mcp-adapter",
];
const OUTFITTER_ROLE_PROMPTS = {
  founder:
    "You are operating as a founder-operator agent: builder, product thinker, research auditor, dense-prose editor, and careful operator. Do not behave like a generic senior engineer or a pure project manager.\n\n" +
    "The repo is the brain. Chat history is transient. Durable facts, decisions, requirements, plans, review outcomes, and lessons belong in project files when the work is substantive.\n\n" +
    "If the user's intent and acceptance criteria are clear, proceed without needless confirmation. Ask briefly when missing information would materially change the artifact, risk profile, or implementation path.\n\n" +
    "For nontrivial work, keep a visible task list with one in-progress item and checkable completion conditions. Requirements and milestone specs should use RFC 2119 keywords and acceptance criteria that can be checked from repo state or named external evidence.\n\n" +
    "Use DeepWork, reviews, tests, browser evidence, source checks, or human-meaningful validation before calling substantive work done.\n\n" +
    "Optimize substantive prose for density. Remove filler, keep every sentence load-bearing, preserve nuance, and avoid summaries that erase interesting claims.\n\n" +
    "Numbers, market claims, schedules, legal or regulatory claims, current facts, prices, and recommendations require source checks when there is a meaningful chance of drift or high-stakes error.\n\n" +
    "Never push, tag, merge, publish, deploy, send external messages, type credentials, make payments, perform legal filings, mutate production, or make irreversible data changes without explicit user approval.",
  engineer:
    "You are operating as an engineering-focused coding agent.\n" +
    "Prioritize maintainable implementation, clear tests, concise diffs, and verification evidence.\n" +
    "Before changing code, inspect the existing project conventions and reuse established patterns.",
  data_analyst:
    "You are operating as a data-analysis-focused agent.\n" +
    "Prioritize careful data inspection, reproducible analysis steps, clear assumptions, and actionable summaries.\n" +
    "When data or methodology is uncertain, call out limitations and validation checks explicitly.",
};
const OUTFITTER_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/u;

export default function outfitter(pi) {
  let mode = "build";
  let buildModeTools;
  let loginSubmitted = false;

  const updateModeStatus = (ctx) => {
    const color = mode === "plan" ? "warning" : "muted";
    ctx.ui.setStatus("outfitter-mode", ctx.ui.theme.fg(color, "mode: " + mode));
  };

  const enterPlanMode = (ctx) => {
    if (mode !== "plan") {
      buildModeTools = pi.getActiveTools();
    }
    mode = "plan";
    const availableTools = new Set(pi.getAllTools().map((tool) => tool.name));
    const planTools = OUTFITTER_PLAN_TOOLS.filter((toolName) => availableTools.has(toolName));
    pi.setActiveTools(planTools.length > 0 ? planTools : OUTFITTER_PLAN_TOOLS);
    updateModeStatus(ctx);
    ctx.ui.notify("Outfitter mode: plan (read-only tools; Shift+Tab to switch back)", "info");
  };

  const enterBuildMode = (ctx) => {
    mode = "build";
    pi.setActiveTools(buildModeTools ?? OUTFITTER_DEFAULT_TOOLS);
    buildModeTools = undefined;
    updateModeStatus(ctx);
    ctx.ui.notify("Outfitter mode: build (normal tools; Shift+Tab for plan mode)", "info");
  };

  const cycleOutfitterMode = (ctx) => {
    if (mode === "plan") {
      enterBuildMode(ctx);
      return;
    }

    enterPlanMode(ctx);
  };

  const exportRuntimeSystemPrompt = async (ctx) => {
    const outputPath = typeof process === "undefined" ? undefined : process.env.OUTFITTER_SYSTEM_PROMPT_EXPORT_PATH;
    if (!outputPath || typeof ctx.getSystemPrompt !== "function") return;

    const systemPrompt = ctx.getSystemPrompt();
    if (typeof systemPrompt !== "string") return;

    const [{ mkdirSync, writeFileSync }, { dirname }] = await Promise.all([import("node:fs"), import("node:path")]);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(
      outputPath,
      [
        "<!-- Generated by Outfitter from Pi runtime ctx.getSystemPrompt(). Safe to review or git-ignore. Do not edit by hand. -->",
        "# Generated Pi runtime system prompt",
        "",
        systemPrompt,
        "",
      ].join("\n"),
    );
  };

  const submitSlashCommand = async (ctx, command, notification) => {
    if (ctx.mode !== "tui") return false;
    ctx.ui.setEditorText(command);
    ctx.ui.notify(notification, "info");
    await ctx.ui.custom((tui, _theme, _keybindings, done) => {
      setTimeout(() => {
        tui.focusedComponent?.handleInput?.("\r");
        done(true);
      }, 25);

      return {
        render: () => [],
        invalidate: () => undefined,
      };
    }, { overlay: true, overlayOptions: { nonCapturing: true, visible: () => false } });
    return true;
  };

  const getAvailableModelCount = async (ctx) => {
    if (ctx.modelRegistry === undefined || typeof ctx.modelRegistry.getAvailable !== "function") {
      return ctx.model === undefined ? 0 : 1;
    }

    try {
      const available = await ctx.modelRegistry.getAvailable();
      return Array.isArray(available) ? available.length : 0;
    } catch {
      return ctx.model === undefined ? 0 : 1;
    }
  };

  const openLoginIfNoModels = async (ctx) => {
    if (loginSubmitted || ctx.mode !== "tui") return;
    const availableModelCount = await getAvailableModelCount(ctx);
    if (availableModelCount > 0) return;
    loginSubmitted = await submitSlashCommand(
      ctx,
      "/login",
      "Outfitter is opening Pi's /login flow because Pi reports no available models. Credentials stay inside Pi.",
    );
  };

  const createQuestionUi = (ctx) => ({
    async selectProfile(profiles, currentDefault) {
      const labels = profiles.map((profile) => formatProfileOption(profile, currentDefault));
      const selectedLabel = await ctx.ui.select(
        [
          "Outfitter profile setup",
          "",
          "Choose the default profile for future 'outfitter' launches. The current Pi process keeps the profile it started with; this setting applies on the next launch.",
          "",
          ...profiles.map(
            (profile) =>
              "• " +
              profile.id +
              (profile.label ? " — " + profile.label : "") +
              (profile.description ? ": " + profile.description : ""),
          ),
        ].join("\n"),
        labels,
      );
      if (selectedLabel === undefined) return undefined;
      return profiles[labels.indexOf(selectedLabel)];
    },
    notify: (message, type = "info") => ctx.ui.notify(message, type),
  });

  const runOutfitterOnboarding = async (ctx) => {
    if (!ctx.hasUI) return;
    const [{ mkdirSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync }, { dirname, join }] =
      await Promise.all([import("node:fs"), import("node:path")]);
    const paths = createOutfitterPaths(join);
    const currentDefault = readCurrentDefaultProfile(paths.settingsPath, existsSync, readFileSync);
    const profiles = discoverProfileChoices({ existsSync, join, readFileSync, readdirSync, statSync }, paths, currentDefault);
    const questionUi = createQuestionUi(ctx);
    const selectedProfile = await questionUi.selectProfile(profiles, currentDefault);

    if (selectedProfile === undefined) {
      questionUi.notify("Outfitter setup cancelled; no settings were changed.", "warning");
      await openLoginIfNoModels(ctx);
      return;
    }

    if (!OUTFITTER_PROFILE_ID_PATTERN.test(selectedProfile.id)) {
      questionUi.notify("Selected profile id is not filesystem-safe; no settings were changed.", "error");
      await openLoginIfNoModels(ctx);
      return;
    }

    mkdirSync(dirname(paths.settingsPath), { recursive: true });
    const settingsExisted = existsSync(paths.settingsPath);
    if (settingsExisted) {
      updateExistingSettingsDefaultProfile(paths.settingsPath, selectedProfile.id, readFileSync, writeFileSync);
    } else {
      writeFileSync(paths.settingsPath, createDefaultSettingsContent(selectedProfile.id));
    }

    const createdFallbackProfile = ensureFallbackProfileIfNeeded(
      { existsSync, join, mkdirSync, writeFileSync },
      paths,
      selectedProfile,
    );
    questionUi.notify(
      [
        "Outfitter saved default profile '" + selectedProfile.id + "' to " + paths.settingsPath + ".",
        "It applies on the next 'outfitter' launch; restart Outfitter to load the selected profile.",
        createdFallbackProfile
          ? "Created a local fallback profile because '" +
            selectedProfile.id +
            "' was not present in loaded profile sources."
          : undefined,
      ].filter(Boolean).join("\n"),
      "info",
    );

    await openLoginIfNoModels(ctx);
  };

  pi.registerCommand("outfitter", {
    description: "Configure Outfitter profile onboarding",
    handler: async (_args, ctx) => {
      await runOutfitterOnboarding(ctx);
    },
  });

  pi.registerCommand("mode", {
    description: "Toggle Outfitter build/plan mode",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      cycleOutfitterMode(ctx);
    },
  });

  pi.on("session_start", async (event, ctx) => {
    await exportRuntimeSystemPrompt(ctx);
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader((_tui, theme) => {
      const lines = [
        theme.bold(theme.fg("accent", "Outfitter")) + theme.fg("dim", " + pi"),
        theme.fg("muted", "/ commands · ! bash · shift+tab mode · ctrl+shift+t thinking · ctrl+o more"),
        "",
        theme.fg(
          "dim",
          "Outfitter + Pi can explain its own features and look up its docs. Ask it how to use or extend Pi or outfitter profiles.",
        ),
      ];
      return {
        render: () => lines,
        invalidate: () => undefined,
      };
    });
    updateModeStatus(ctx);
    ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, "shift+tab")) return undefined;
      cycleOutfitterMode(ctx);
      return { consume: true };
    });

    if (event.reason === "startup" && OUTFITTER_AUTO_OPEN) {
      await submitSlashCommand(ctx, "/outfitter", "Outfitter is opening /outfitter to finish profile setup inside Pi.");
      return;
    }

    await openLoginIfNoModels(ctx);
  });

  pi.on("tool_call", async (event) => {
    if (mode !== "plan" || event.toolName !== "bash") return;

    return {
      block: true,
      reason: "Outfitter plan mode blocks Bash commands. Press Shift+Tab to return to build mode. Command: " + String(event.input?.command ?? ""),
    };
  });

  pi.on("context", async (event) => {
    const messages = event.messages.filter((message) => message.customType !== "outfitter-mode-context");

    if (mode !== "plan") {
      return { messages };
    }

    return {
      messages: [
        ...messages,
        {
          role: "custom",
          customType: "outfitter-mode-context",
          content:
            "[OUTFITTER PLAN MODE ACTIVE]\n" +
            "You are in read-only planning mode. Inspect files and explain the implementation plan, but do not modify files, run Bash commands, or claim changes are done. Ask before leaving planning mode.",
          display: false,
        },
      ],
    };
  });
}

const createOutfitterPaths = (join) => ({
  settingsPath: join(OUTFITTER_HOME, ".outfitter", "settings.yml"),
  localProfilesPath: join(OUTFITTER_HOME, ".outfitter", "profiles"),
  defaultProfilesPath: OUTFITTER_DEFAULT_PROFILES_PATH,
});

const readCurrentDefaultProfile = (settingsPath, existsSync, readFileSync) => {
  if (!existsSync(settingsPath)) return undefined;
  const match = /^default_profile:\s*([^\n#]+)/mu.exec(readFileSync(settingsPath, "utf8"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
};

const discoverProfileChoices = (fs, paths, currentDefault) => {
  const discovered = new Map();
  const addProfile = (profile, loaded) => {
    if (!profile?.id || !OUTFITTER_PROFILE_ID_PATTERN.test(profile.id)) return;
    const existing = discovered.get(profile.id);
    discovered.set(profile.id, {
      id: profile.id,
      label: profile.label ?? existing?.label,
      description: profile.description ?? existing?.description,
      loaded: Boolean(existing?.loaded || loaded),
    });
  };

  for (const profile of readProfilesFromSource(fs, paths.defaultProfilesPath)) addProfile(profile, true);
  for (const profile of readProfilesFromSource(fs, paths.localProfilesPath)) addProfile(profile, true);
  for (const profile of OUTFITTER_STANDARD_PROFILES) addProfile(profile, false);

  return [...discovered.values()].sort((left, right) => compareProfiles(left, right, currentDefault));
};

const readProfilesFromSource = (fs, sourcePath) => {
  if (!sourcePath || !fs.existsSync(sourcePath)) return [];
  let entries;
  try {
    entries = fs.readdirSync(sourcePath).sort();
  } catch {
    return [];
  }

  return entries.flatMap((entryName) => {
    const entryPath = fs.join(sourcePath, entryName);
    let entryStat;
    try {
      entryStat = fs.statSync(entryPath);
    } catch {
      return [];
    }

    if (entryStat.isDirectory()) {
      const profilePath = fs.join(entryPath, "profile.yml");
      return fs.existsSync(profilePath) ? [readProfileYaml(fs.readFileSync(profilePath, "utf8"), entryName)] : [];
    }

    if (!entryStat.isFile() || !/\.ya?ml$/u.test(entryName) || entryName === "profile.yml") return [];
    return [readProfileYaml(fs.readFileSync(entryPath, "utf8"), entryName.replace(/\.ya?ml$/u, ""))];
  }).filter((profile) => profile.template !== true);
};

const readProfileYaml = (content, fallbackId) => ({
  id: readYamlString(content, "id") ?? fallbackId,
  label: readYamlString(content, "label"),
  description: readYamlString(content, "description"),
  template: readYamlString(content, "template") === "true",
});

const readYamlString = (content, key) => {
  const match = new RegExp("^" + key + ":\\s*([^\\n#]+)", "mu").exec(content);
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
};

const compareProfiles = (left, right, currentDefault) => {
  if (currentDefault !== undefined) {
    if (left.id === currentDefault) return -1;
    if (right.id === currentDefault) return 1;
  }

  const leftIndex = OUTFITTER_STANDARD_PROFILE_ORDER.indexOf(left.id);
  const rightIndex = OUTFITTER_STANDARD_PROFILE_ORDER.indexOf(right.id);
  const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
  const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
  if (normalizedLeftIndex !== normalizedRightIndex) return normalizedLeftIndex - normalizedRightIndex;
  return left.id.localeCompare(right.id);
};

const formatProfileOption = (profile, currentDefault) => {
  const current = profile.id === currentDefault ? " (current)" : "";
  const recommended = currentDefault === undefined && profile.id === "founder" ? " (Recommended)" : "";
  return profile.id + (profile.label ? " — " + profile.label : "") + current + recommended;
};

const createDefaultSettingsContent = (profileId) =>
  OUTFITTER_DEFAULT_SETTINGS_TEMPLATE.replace("__OUTFITTER_PROFILE_ID__", profileId);

const updateExistingSettingsDefaultProfile = (settingsPath, profileId, readFileSync, writeFileSync) => {
  const content = readFileSync(settingsPath, "utf8");
  const nextContent = /^default_profile:.*$/mu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, "default_profile: " + profileId)
    : content.replace(/\s*$/u, "\n") + "default_profile: " + profileId + "\n";
  writeFileSync(settingsPath, nextContent);
};

const ensureFallbackProfileIfNeeded = (fs, paths, profile) => {
  if (profile.loaded) return false;
  const profilePath = fs.join(paths.localProfilesPath, profile.id, "profile.yml");
  if (fs.existsSync(profilePath)) return false;
  fs.mkdirSync(fs.join(paths.localProfilesPath, profile.id), { recursive: true });
  fs.writeFileSync(profilePath, createFallbackProfileContent(profile));
  return true;
};

const createFallbackProfileContent = (profile) => {
  const lines = [
    "id: " + profile.id,
    "label: " + (profile.label ?? profile.id),
    "description: " + (profile.description ?? "Outfitter-managed default profile."),
    "controls:",
  ];
  if (profile.id === "founder") {
    lines.push("  pi:", "    extensions:", ...OUTFITTER_RECOMMENDED_LOADOUT.map((source) => "      - " + source));
  }
  const prompt = OUTFITTER_ROLE_PROMPTS[profile.id];
  if (prompt !== undefined) {
    lines.push("  append_system_prompt: |", ...prompt.split("\n").map((line) => "    " + line));
  }
  lines.push("");
  return lines.join("\n");
};
`;
};

const writePiLaunchMessage = (writeLine: ((message: string) => void) | undefined, message: string): void => {
  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer for launch messages. */
  (writeLine ?? console.log)(message);
};

export const isNonInteractivePiLaunch = (args: readonly string[]): boolean =>
  args.some((arg, index) => {
    if (nonInteractivePiLaunchFlags.has(arg)) {
      return true;
    }

    if (arg === '--mode') {
      return nonInteractivePiModes.has(args[index + 1] ?? '');
    }

    if (arg.startsWith('--mode=')) {
      return nonInteractivePiModes.has(arg.slice('--mode='.length));
    }

    return false;
  });

const hasConfiguredPiLoginState = (piConfigDirectory: string): boolean =>
  hasConfiguredPiStateFile(piConfigDirectory, 'auth.json') ||
  hasConfiguredPiStateFile(piConfigDirectory, 'models.json');

const hasConfiguredPiStateFile = (piConfigDirectory: string, fileName: string): boolean => {
  const statePath = join(piConfigDirectory, fileName);

  if (!existsSync(statePath)) {
    return false;
  }

  try {
    return hasConfiguredPiStateEntries(JSON.parse(readFileSync(statePath, 'utf8')));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return false;
    }

    throw new Error(`Could not read pi login state file '${statePath}': ${String(error)}`, { cause: error });
  }
};

const hasConfiguredPiStateEntries = (value: unknown): boolean => {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value === null || typeof value !== 'object') {
    return false;
  }

  const record = value as Readonly<Record<string, unknown>>;
  const containerKeys = ['models', 'providers', 'model_providers'];
  const presentContainers = containerKeys.filter((key) => Object.hasOwn(record, key));

  if (presentContainers.length > 0) {
    return presentContainers.some((key) => hasConfiguredPiStateEntries(record[key]));
  }

  return Object.keys(record).length > 0;
};
