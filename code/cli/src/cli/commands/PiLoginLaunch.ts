/* eslint-disable max-lines, complexity */
// Prepares Pi launch-time bootstrap extensions for Outfitter UX, login, and setup handoffs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import { createDefaultSettingsContent as createSetupDefaultSettingsContent } from './SetupCommand.js';

export interface PiRuntimeOnboardingLaunchInput {
  readonly autoOpenOutfitter?: boolean;
  readonly defaultProfilesPath?: string;
  readonly projectDirectory?: string;
  readonly setupSourceUri?: string;
}

export interface PiLoginLaunchPlanInput {
  readonly adapterId: string;
  readonly homeDirectory: string;
  readonly launchPlan: AgentLaunchPlan;
  readonly runtimeOnboarding?: PiRuntimeOnboardingLaunchInput;
  readonly startupAsciiArt?: boolean;
  readonly writeLine?: (message: string) => void;
}

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

  if (input.runtimeOnboarding?.autoOpenOutfitter === true) {
    writeQuietPiStartupSettings(piConfigDirectory);
    launchPlan = addFirstRunBootstrapModelIfNeeded(launchPlan);
  }

  writePiOutfitterEnterpriseSupportFiles(piConfigDirectory);

  launchPlan = addExtension(
    launchPlan,
    piConfigDirectory,
    'outfitter-extension.js',
    createPiOutfitterExtensionContent({
      autoOpenOutfitter: input.runtimeOnboarding?.autoOpenOutfitter === true,
      defaultProfilesPath: input.runtimeOnboarding?.defaultProfilesPath,
      homeDirectory: input.homeDirectory,
      projectDirectory: resolve(input.runtimeOnboarding?.projectDirectory ?? process.cwd()),
      setupSourceUri: input.runtimeOnboarding?.setupSourceUri,
      startupAsciiArt: input.startupAsciiArt ?? true,
    }),
  );

  if (!hasConfiguredPiLoginState(piConfigDirectory)) {
    writePiLaunchMessage(input.writeLine, runtimeLoginMessage);
  }

  return launchPlan;
};

const addFirstRunBootstrapModelIfNeeded = (launchPlan: AgentLaunchPlan): AgentLaunchPlan => {
  if (hasPiModelArg(launchPlan.args)) {
    return launchPlan;
  }

  return { ...launchPlan, args: ['--model', 'google/gemini-3.1-pro-preview', ...launchPlan.args] };
};

/* v8 ignore next -- arg parser supports both spellings; integration smoke covers explicit --model passthrough. */
const hasPiModelArg = (args: readonly string[]): boolean =>
  args.some((arg) => arg === '--model' || arg.startsWith('--model='));

const writeQuietPiStartupSettings = (piConfigDirectory: string): void => {
  const settingsPath = join(piConfigDirectory, 'settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
      /* v8 ignore next -- defensive against hand-edited Pi settings with non-object JSON. */
      settings =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      settings = {};
    }
  }

  writeFileSync(settingsPath, `${JSON.stringify({ ...settings, quietStartup: true }, null, 2)}\n`);
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

const writePiOutfitterEnterpriseSupportFiles = (piConfigDirectory: string): void => {
  const extensionDirectory = join(piConfigDirectory, 'outfitter');
  const supportFiles = [
    ['pi-extension/privateCatalogOnboarding.js', 'pi-extension/privateCatalogOnboarding.js'],
    ['shared/privateCatalogPolicy.cjs', 'shared/privateCatalogPolicy.cjs'],
  ] as const;

  for (const [from, to] of supportFiles) {
    const destination = join(extensionDirectory, to);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readEnterpriseSupportFile(from));
  }
};

const readEnterpriseSupportFile = (relativePath: string): string => {
  const sourcePath = fileURLToPath(new URL(`../../../../enterprise/${relativePath}`, import.meta.url));
  const packagePath = fileURLToPath(new URL(`../../../code/enterprise/${relativePath}`, import.meta.url));

  /* v8 ignore else -- packaged npm layout is exercised after build, not unit tests. */
  if (existsSync(sourcePath)) {
    return readFileSync(sourcePath, 'utf8');
  }

  /* v8 ignore next -- packaged npm layout is exercised after build, not unit tests. */
  if (existsSync(packagePath)) {
    return readFileSync(packagePath, 'utf8');
  }

  /* v8 ignore next -- defensive packaging assertion for missing enterprise support files. */
  throw new Error(`Outfitter enterprise support file '${relativePath}' was not found.`);
};

// The general Outfitter pi extension. It brands the startup header, owns
// Outfitter-specific interactive shortcuts, registers native /outfitter, and
// keeps credential entry delegated to Pi's native /login command.
const createPiOutfitterExtensionContent = (input: {
  readonly autoOpenOutfitter: boolean;
  readonly defaultProfilesPath?: string;
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly setupSourceUri?: string;
  readonly startupAsciiArt: boolean;
}): string => {
  const defaultSettingsTemplate = createSetupDefaultSettingsContent('__OUTFITTER_PROFILE_ID__');
  const startupAsciiArt = readFileSync(new URL('./assets/outfitter-ascii.txt', import.meta.url), 'utf8').trimEnd();

  return String.raw`import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const OUTFITTER_PLAN_TOOLS = ["read", "grep", "find", "ls"];
const OUTFITTER_DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const OUTFITTER_HOME = ${JSON.stringify(input.homeDirectory)};
const OUTFITTER_PROJECT = ${JSON.stringify(input.projectDirectory)};
const OUTFITTER_DEFAULT_PROFILES_PATH = ${JSON.stringify(input.defaultProfilesPath)};
const OUTFITTER_SETUP_SOURCE_URI = ${JSON.stringify(input.setupSourceUri)};
const OUTFITTER_AUTO_OPEN = ${JSON.stringify(input.autoOpenOutfitter)};
const OUTFITTER_DEFAULT_SETTINGS_TEMPLATE = ${JSON.stringify(defaultSettingsTemplate)};
const OUTFITTER_STARTUP_ASCII_ART = ${JSON.stringify(input.startupAsciiArt)};
const OUTFITTER_ASCII_ART = ${JSON.stringify(startupAsciiArt)};
const OUTFITTER_ASCII_GRADIENT = ["success", "accent", "text", "muted", "dim"];
const OUTFITTER_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$/u;
const loadPrivateCatalogOnboarding = () => import("./pi-extension/privateCatalogOnboarding.js");

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

  pi.on("project_trust", async (event) => {
    if (!OUTFITTER_AUTO_OPEN || event.cwd !== OUTFITTER_PROJECT) {
      return { trusted: "undecided" };
    }

    return { trusted: "yes", remember: true };
  });

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
    if (notification !== undefined) ctx.ui.notify(notification, "info");
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

  const confirmModelProviderConnection = async (ctx) => {
    if (typeof ctx.ui.custom !== "function") return true;
    const selected = await selectDescribedOption(
      ctx,
      [
        "Pi does not have a model provider connected yet.",
        "Connect one now so Outfitter can use Pi.",
        "Credentials stay inside Pi.",
      ],
      [{ value: "connect", label: "Connect a model provider" }],
      "connect",
    );
    return selected === "connect";
  };

  const openLoginIfNoModels = async (ctx) => {
    if (loginSubmitted || ctx.mode !== "tui") return;
    const availableModelCount = await getAvailableModelCount(ctx);
    if (availableModelCount > 0) return;
    if (!(await confirmModelProviderConnection(ctx))) return;
    loginSubmitted = await submitSlashCommand(ctx, "/login");
  };

  const createQuestionUi = (ctx) => ({
    async selectSetupMode() {
      const options = [
        "Use the default Outfitter profile catalog",
        "Create your own profile",
        "Provide a different catalog to import",
      ];
      const selected = await ctx.ui.select("How would you like to set up Outfitter?", options);
      if (selected === undefined) return undefined;
      return options.indexOf(selected) === 1 ? "create" : options.indexOf(selected) === 2 ? "catalog" : "default";
    },
    async selectInstallTarget(paths) {
      const items = [
        {
          value: "home",
          label: "Home folder (~/.outfitter)",
          description: "These profiles will be available anywhere you start outfitter.",
        },
        {
          value: "project",
          label: "Current project directory (.outfitter)",
          description: "These profiles will only be available in the current project directory and will compose the profiles of the same name in the home folder.",
        },
      ];
      const title = ["Where should Outfitter install these settings?"];
      const selected = typeof ctx.ui.custom === "function"
        ? await selectDescribedOption(ctx, title, items, "home")
        : await ctx.ui.select(title.join("\n"), items.map((item) => item.label));
      if (selected === undefined) return undefined;
      const selectedValue = items.some((item) => item.value === selected)
        ? selected
        : items.find((item) => item.label === selected)?.value;
      return selectedValue === "project"
        ? { id: "project", settingsPath: paths.projectSettingsPath, profilesPath: paths.projectProfilesPath }
        : { id: "home", settingsPath: paths.homeSettingsPath, profilesPath: paths.homeProfilesPath };
    },
    async selectProfile(profiles, currentDefault) {
      const items = profiles.map((profile) => ({
        value: profile.id,
        label: formatProfileLabel(profile, currentDefault),
        description: profile.description,
      }));
      const title = [
        "Outfitter profile setup",
        "",
        "Choose the default profile from the selected catalog for future 'outfitter' launches.",
        "The current Pi process keeps the profile it started with; this setting applies on the next launch.",
      ];
      const initialProfileId = currentDefault ?? (profiles.some((profile) => profile.id === "founder") ? "founder" : profiles[0]?.id);
      const selectedId = typeof ctx.ui.custom === "function"
        ? await selectDescribedOption(ctx, title, items, initialProfileId)
        : await ctx.ui.select(title.join("\n"), items.map((item) => item.label));
      if (selectedId === undefined) return undefined;
      return profiles.find((profile) => profile.id === selectedId) ?? profiles[items.findIndex((item) => item.label === selectedId)];
    },
    async input(message, defaultValue) {
      if (typeof ctx.ui.input === "function") {
        return ctx.ui.input(message, defaultValue === undefined ? undefined : { defaultValue });
      }
      const suffix = defaultValue === undefined ? "" : " [" + defaultValue + "]";
      const selected = await ctx.ui.select(message + suffix, [defaultValue ?? ""]);
      return selected;
    },
    async confirmPrivateCatalog(repository) {
      const { confirmPrivateCatalog } = await loadPrivateCatalogOnboarding();
      return confirmPrivateCatalog(ctx, selectDescribedOption, repository);
    },
    notify: (message, type = "info") => ctx.ui.notify(message, type),
  });

  const runOutfitterOnboarding = async (ctx) => {
    if (!ctx.hasUI) return;
    const [{ mkdirSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync }, { dirname, join }] =
      await Promise.all([import("node:fs"), import("node:path")]);
    const paths = createOutfitterPaths(join);
    const questionUi = createQuestionUi(ctx);

    if (OUTFITTER_SETUP_SOURCE_URI !== undefined) {
      await runProvidedSourceOnboarding({ mkdirSync, writeFileSync, dirname }, paths, questionUi, OUTFITTER_SETUP_SOURCE_URI);
      await openLoginIfNoModels(ctx);
      return;
    }

    const setupMode = await questionUi.selectSetupMode();

    if (setupMode === undefined) {
      questionUi.notify("Outfitter setup cancelled; no settings were changed.", "warning");
      await openLoginIfNoModels(ctx);
      return;
    }

    if (setupMode === "catalog") {
      await runRemoteSettingsOnboarding({ existsSync, mkdirSync, readFileSync, writeFileSync, dirname }, paths, questionUi);
      await openLoginIfNoModels(ctx);
      return;
    }

    if (setupMode === "create") {
      await runCreateProfileOnboarding({ existsSync, mkdirSync, readFileSync, writeFileSync, dirname, join }, paths, questionUi);
      await openLoginIfNoModels(ctx);
      return;
    }

    await runDefaultCatalogOnboarding(
      { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, dirname, join },
      paths,
      questionUi,
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
      const lines = createStartupHeaderLines(theme, event.reason === "startup" && OUTFITTER_AUTO_OPEN);
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
      await submitSlashCommand(ctx, "/outfitter");
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

const createStartupHeaderLines = (theme, firstRun) => {
  const brandLine = theme.bold(theme.fg("accent", "Outfitter")) + theme.fg("dim", " + pi");
  const commandHelp = theme.fg("muted", "/ commands · ! bash · shift+tab mode · ctrl+shift+t thinking · ctrl+o more");
  const lines = [];

  if (OUTFITTER_STARTUP_ASCII_ART) {
    lines.push(
      ...OUTFITTER_ASCII_ART.split("\n").map((line, index) => theme.fg(OUTFITTER_ASCII_GRADIENT[index] ?? "accent", line)),
      "",
    );
  }

  lines.push(brandLine, commandHelp);

  if (firstRun) {
    lines.push(
      "",
      theme.fg("dim", "Outfitter turns Pi into a configured working environment:"),
      theme.fg("dim", "• profiles define model, tools, prompts, skills, and extensions"),
      theme.fg("dim", "• settings can live in your home folder or this project"),
      theme.fg("dim", "• catalogs let teams share setups through GitHub"),
    );
    return lines;
  }

  lines.push(
    "",
    theme.fg(
      "dim",
      "Outfitter + Pi can explain its own features and look up its docs. Ask it how to use or extend Pi or outfitter profiles.",
    ),
  );
  return lines;
};

const createOutfitterPaths = (join) => ({
  homeSettingsPath: join(OUTFITTER_HOME, ".outfitter", "settings.yml"),
  homeProfilesPath: join(OUTFITTER_HOME, ".outfitter", "profiles"),
  projectSettingsPath: join(OUTFITTER_PROJECT, ".outfitter", "settings.yml"),
  projectProfilesPath: join(OUTFITTER_PROJECT, ".outfitter", "profiles"),
  defaultProfilesPath: OUTFITTER_DEFAULT_PROFILES_PATH,
});

const runDefaultCatalogOnboarding = async (fs, paths, questionUi) => {
  const currentDefault = readCurrentDefaultProfile(paths.homeSettingsPath, fs.existsSync, fs.readFileSync);
  const profiles = discoverProfileChoices(fs, paths, currentDefault);
  if (profiles.length === 0) {
    questionUi.notify(
      "No profiles were found in the default Outfitter profile catalog. Fix the catalog sync or provide a different catalog.",
      "error",
    );
    return;
  }

  const selectedProfile = await questionUi.selectProfile(profiles, currentDefault);
  if (selectedProfile === undefined) {
    questionUi.notify("Outfitter setup cancelled; no settings were changed.", "warning");
    return;
  }

  if (!OUTFITTER_PROFILE_ID_PATTERN.test(selectedProfile.id)) {
    questionUi.notify("Selected profile id is not filesystem-safe; no settings were changed.", "error");
    return;
  }

  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify("Outfitter setup cancelled; no settings were changed.", "warning");
    return;
  }

  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  fs.mkdirSync(installTarget.profilesPath, { recursive: true });
  const settingsExisted = fs.existsSync(installTarget.settingsPath);
  if (settingsExisted) {
    updateExistingSettingsDefaultProfile(installTarget.settingsPath, selectedProfile.id, fs.readFileSync, fs.writeFileSync);
  } else {
    fs.writeFileSync(installTarget.settingsPath, createDefaultSettingsContent(selectedProfile.id));
  }

  questionUi.notify(
    [
      "Outfitter saved default profile '" + selectedProfile.id + "' to " + installTarget.settingsPath + ".",
      "Profile choices were loaded from the default Outfitter profile catalog, not generated locally.",
      "It applies on the next 'outfitter' launch; restart Outfitter to load the selected profile.",
    ].join("\n"),
    "info",
  );
};

const runCreateProfileOnboarding = async (fs, paths, questionUi) => {
  const profileId = normalizeInputValue(await questionUi.input("Profile id", "my_profile"));
  if (!profileId || !OUTFITTER_PROFILE_ID_PATTERN.test(profileId)) {
    questionUi.notify("Profile id is not filesystem-safe; no settings were changed.", "error");
    return;
  }
  const label = normalizeInputValue(await questionUi.input("Profile label", profileId));
  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify("Outfitter setup cancelled; no settings were changed.", "warning");
    return;
  }

  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  if (fs.existsSync(installTarget.settingsPath)) {
    updateExistingSettingsDefaultProfile(installTarget.settingsPath, profileId, fs.readFileSync, fs.writeFileSync);
  } else {
    fs.writeFileSync(installTarget.settingsPath, createLocalProfileSettingsContent(profileId));
  }

  const profilePath = fs.join(installTarget.profilesPath, profileId, "profile.yml");
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(fs.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, createUserProfileContent(profileId, label));
  }

  questionUi.notify(
    [
      "Outfitter created profile '" + profileId + "' at " + profilePath + ".",
      "Outfitter saved settings to " + installTarget.settingsPath + ".",
      "It applies on the next 'outfitter' launch; restart Outfitter to load the selected profile.",
    ].join("\n"),
    "info",
  );
};

const runRemoteSettingsOnboarding = async (fs, paths, questionUi) => {
  const github = normalizeInputValue(await questionUi.input("GitHub catalog repo (owner/repo)", "my_account/outfitter_config"));
  const ref = normalizeInputValue(await questionUi.input("Catalog ref", "main")) || "main";
  const settingsPath = normalizeInputValue(await questionUi.input("Catalog settings path", "settings.yml")) || "settings.yml";
  if (!github || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(github)) {
    questionUi.notify("Catalog repo must use owner/repo syntax; no settings were changed.", "error");
    return;
  }
  if (settingsPath.startsWith("/") || settingsPath.includes("..")) {
    questionUi.notify("Catalog settings path must stay inside the repository; no settings were changed.", "error");
    return;
  }

  const privateCatalogOnboarding = await loadPrivateCatalogOnboarding();
  const privateCatalogsAlreadyEnabled = privateCatalogOnboarding.readPrivateProfileCatalogsEnabled(fs, paths.homeSettingsPath);
  let privateCatalogAccepted = false;
  if (!privateCatalogsAlreadyEnabled && await privateCatalogOnboarding.classifyGitHubRepositoryVisibility(github) === "private") {
    const accepted = await questionUi.confirmPrivateCatalog(github);
    if (!accepted) {
      questionUi.notify("Private catalog setup was cancelled; no settings were changed.", "warning");
      return;
    }

    privateCatalogAccepted = true;
  }

  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify("Outfitter setup cancelled; no settings were changed.", "warning");
    return;
  }

  if (privateCatalogAccepted) {
    privateCatalogOnboarding.writePrivateProfileCatalogsEnabled(fs, paths.homeSettingsPath);
  }

  const privateCatalogsEnabled = privateCatalogsAlreadyEnabled || privateCatalogAccepted;
  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  fs.writeFileSync(installTarget.settingsPath, createRemoteSettingsContent(github, ref, settingsPath, privateCatalogsEnabled && installTarget.settingsPath === paths.homeSettingsPath));
  questionUi.notify(
    privateCatalogAccepted
      ? "Outfitter enabled private profile catalogs in ~/.outfitter/settings.yml and saved this catalog."
      : [
          "Outfitter saved remote settings catalog to " + installTarget.settingsPath + ".",
          "Run 'outfitter sync' or restart Outfitter after the catalog is reachable.",
        ].join("\n"),
    "info",
  );
};

const runProvidedSourceOnboarding = async (fs, paths, questionUi, sourceUri) => {
  const installTarget = await questionUi.selectInstallTarget(paths);
  if (installTarget === undefined) {
    questionUi.notify("Outfitter setup cancelled; no settings were changed.", "warning");
    return;
  }

  fs.mkdirSync(fs.dirname(installTarget.settingsPath), { recursive: true });
  fs.writeFileSync(installTarget.settingsPath, createProvidedSourceSettingsContent(sourceUri));
  questionUi.notify(
    [
      "Outfitter saved setup source to " + installTarget.settingsPath + ".",
      "Run 'outfitter sync' or restart Outfitter after the source is reachable.",
    ].join("\n"),
    "info",
  );
};

const normalizeInputValue = (value) => typeof value === "string" ? value.trim() : undefined;

const createProvidedSourceSettingsContent = (sourceUri) =>
  ["remote_settings:", "  - uri: " + JSON.stringify(sourceUri), "    path: settings.yml", ""].join("\n");

const readCurrentDefaultProfile = (settingsPath, existsSync, readFileSync) => {
  if (!existsSync(settingsPath)) return undefined;
  const match = /^default_profile:\s*([^\n#]+)/mu.exec(readFileSync(settingsPath, "utf8"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
};

const discoverProfileChoices = (fs, paths, currentDefault) => {
  const discovered = new Map();
  const addProfile = (profile) => {
    if (!profile?.id || !OUTFITTER_PROFILE_ID_PATTERN.test(profile.id)) return;
    const existing = discovered.get(profile.id);
    discovered.set(profile.id, {
      id: profile.id,
      label: profile.label ?? existing?.label,
      description: profile.description ?? existing?.description,
    });
  };

  for (const profile of readProfilesFromSource(fs, paths.defaultProfilesPath)) addProfile(profile);

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
  if (left.id === "founder") return -1;
  if (right.id === "founder") return 1;
  return left.id.localeCompare(right.id);
};

const selectDescribedOption = (ctx, titleLines, items, initialValue) =>
  ctx.ui.custom((tui, theme, _keybindings, done) => {
    let selectedIndex = Math.max(0, items.findIndex((item) => item.value === initialValue));
    const labelWidth = Math.max(...items.map((item) => item.label.length));
    let cachedWidth;
    let cachedLines;

    const finish = (value) => done(value);
    const refresh = () => {
      cachedWidth = undefined;
      cachedLines = undefined;
      tui.requestRender?.();
    };
    const move = (delta) => {
      selectedIndex = Math.max(0, Math.min(items.length - 1, selectedIndex + delta));
      refresh();
    };

    const render = (width) => {
      const maxWidth = typeof width === "number" && width > 0 ? width : 120;
      if (cachedLines && cachedWidth === maxWidth) return cachedLines;

      const lines = [];
      const add = (line) => lines.push(visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth) : line);
      const addWrapped = (line, widthForWrap = maxWidth, prefix = "") => {
        for (const wrappedLine of wrapTextWithAnsi(line, Math.max(1, widthForWrap))) {
          add(prefix + wrappedLine);
        }
      };
      const renderSelectedItem = (prefix, label, description) => {
        const baseLine = prefix + label;
        if (!description) {
          add(baseLine);
          return;
        }

        const inlineDescriptionWidth = maxWidth - visibleWidth(baseLine) - 2;
        const descriptionText = theme.fg("muted", description);
        if (inlineDescriptionWidth >= 30) {
          const [firstLine = "", ...remainingLines] = wrapTextWithAnsi(descriptionText, inlineDescriptionWidth);
          add(baseLine + "  " + firstLine);
          const continuationPrefix = " ".repeat(Math.min(maxWidth, visibleWidth(baseLine) + 2));
          for (const line of remainingLines) add(continuationPrefix + line);
          return;
        }

        add(baseLine);
        addWrapped(descriptionText, maxWidth - 2, "  ");
      };

      add(theme.fg("accent", "─".repeat(maxWidth)));
      titleLines.forEach((line, index) => addWrapped(index === 0 ? theme.fg("text", " " + line) : theme.fg("dim", " " + line)));
      lines.push("");

      items.forEach((item, index) => {
        const selected = index === selectedIndex;
        const prefix = selected ? theme.fg("accent", "→ ") : "  ";
        const paddedLabel = item.label.padEnd(labelWidth);
        const label = selected ? theme.fg("accent", paddedLabel) : paddedLabel;
        renderSelectedItem(prefix, label, selected ? item.description : undefined);
      });

      lines.push("");
      add(theme.fg("dim", "↑↓ navigate  enter select  escape/ctrl+c cancel"));
      add(theme.fg("accent", "─".repeat(maxWidth)));

      cachedWidth = maxWidth;
      cachedLines = lines;
      return lines;
    };

    return {
      outfitterOptions: items.map((item) => item.label),
      render,
      invalidate: refresh,
      handleInput: (data) => {
        if (matchesKey(data, Key.up)) move(-1);
        else if (matchesKey(data, Key.down)) move(1);
        else if (matchesKey(data, Key.enter)) finish(items[selectedIndex]?.value);
        else if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) finish(undefined);
      },
    };
  });

const formatProfileLabel = (profile, currentDefault) => {
  const current = profile.id === currentDefault ? " (current)" : "";
  const recommended = currentDefault === undefined && profile.id === "founder" ? " (Recommended)" : "";
  const label = profile.label ? " — " + profile.label : "";
  return profile.id + label + current + recommended;
};

const createDefaultSettingsContent = (profileId) =>
  OUTFITTER_DEFAULT_SETTINGS_TEMPLATE.replace("__OUTFITTER_PROFILE_ID__", profileId);

const createLocalProfileSettingsContent = (profileId) =>
  ["default_profile: " + profileId, "profile_sources:", "  - path: ./profiles", ""].join("\n");

const createRemoteSettingsContent = (github, ref, path, privateCatalogsEnabled = false) =>
  [
    ...(privateCatalogsEnabled ? ["enterprise:", "  private_profile_catalogs: true"] : []),
    "remote_settings:",
    "  - github: " + github,
    "    ref: " + ref,
    "    path: " + path,
    "",
  ].join("\n");

const updateExistingSettingsDefaultProfile = (settingsPath, profileId, readFileSync, writeFileSync) => {
  const content = readFileSync(settingsPath, "utf8");
  const nextContent = /^default_profile:.*$/mu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, "default_profile: " + profileId)
    : content.replace(/\s*$/u, "\n") + "default_profile: " + profileId + "\n";
  writeFileSync(settingsPath, nextContent);
};

const createUserProfileContent = (profileId, label) =>
  [
    "id: " + profileId,
    "label: " + (label || profileId),
    "description: User-created Outfitter profile.",
    "controls: {}",
    "",
  ].join("\n");
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
