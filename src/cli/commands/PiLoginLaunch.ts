// Prepares Pi launch-time bootstrap extensions for Outfitter UX, login, and setup handoffs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AgentLaunchPlan } from '../../agents/AgentAdapter.js';
import type { SetupCommandResult } from './SetupCommand.js';

export interface PiLoginLaunchPlanInput {
  readonly adapterId: string;
  readonly homeDirectory: string;
  readonly launchPlan: AgentLaunchPlan;
  readonly setupResult?: SetupCommandResult;
  readonly writeLine?: (message: string) => void;
}

const outfitterSkillMessage =
  'No profile set up. Outfitter will open `/outfitter` automatically so you can configure a profile.';

const manualLoginMessage =
  'Pi does not appear to be logged in yet. After Pi starts, run `/login` and choose a subscription such as Codex or provide an API key from another model provider.';

const automaticLoginMessage =
  'Pi does not appear to be logged in yet. Outfitter will open `/login` automatically after Pi starts.';

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--export', '--list-models']);
const nonInteractivePiModes = new Set(['json', 'print', 'rpc']);

export const preparePiLoginLaunchPlan = (input: PiLoginLaunchPlanInput): AgentLaunchPlan => {
  if (input.adapterId !== 'pi') {
    return input.launchPlan;
  }

  // Load the Outfitter runtime extension for every interactive pi session. It brands the
  // startup header today and is the home for future Outfitter↔pi integration. The header
  // text is compiled into pi, so a launch-time extension is the only repo-local override.
  // Non-interactive launches (--print, --export, …) keep pi untouched.
  let launchPlan = input.launchPlan;
  const piConfigDirectory = input.launchPlan.env.PI_CODING_AGENT_DIR ?? join(input.homeDirectory, '.pi', 'agent');
  const interactiveLaunch = !isNonInteractivePiLaunch(input.launchPlan.args);
  if (interactiveLaunch) {
    launchPlan = addExtension(launchPlan, piConfigDirectory, 'outfitter-extension.js', piOutfitterExtensionContent);
  }

  if (!hasConfiguredPiLoginState(piConfigDirectory)) {
    if (shouldAutoOpenPiLogin(input.setupResult, input.launchPlan.args)) {
      writePiLoginMessage(input.writeLine, automaticLoginMessage);
      return addExtension(launchPlan, piConfigDirectory, 'prefill-login-extension.js', piLoginPrefillExtensionContent);
    }

    if (interactiveLaunch) {
      writePiLoginMessage(input.writeLine, manualLoginMessage);
    }
    return launchPlan;
  }

  if (shouldAutoOpenOutfitterSkill(input.setupResult, input.launchPlan.args)) {
    writePiLoginMessage(input.writeLine, outfitterSkillMessage);
    return addExtension(
      launchPlan,
      piConfigDirectory,
      'prefill-outfitter-extension.js',
      piOutfitterPrefillExtensionContent,
    );
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

// The general Outfitter pi extension. It brands the startup header and owns
// Outfitter-specific interactive shortcuts that must run after pi has started.
const piOutfitterExtensionContent = String.raw`import { matchesKey } from "@earendil-works/pi-tui";

const OUTFITTER_PLAN_TOOLS = ["read", "grep", "find", "ls"];
const OUTFITTER_DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

export default function outfitter(pi) {
  let mode = "build";
  let buildModeTools;

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

  pi.registerCommand("mode", {
    description: "Toggle Outfitter build/plan mode",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;
      cycleOutfitterMode(ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
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
`;

const createPiPrefillExtensionContent = (input: {
  readonly functionName: string;
  readonly editorText: string;
  readonly notification: string;
}): string => `export default function ${input.functionName}(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText(${JSON.stringify(input.editorText)});
    ctx.ui.notify(${JSON.stringify(input.notification)}, "info");
    await ctx.ui.custom((tui, _theme, _keybindings, done) => {
      setTimeout(() => {
        tui.focusedComponent?.handleInput?.("\\r");
        done();
      }, 25);

      return {
        render: () => [],
        invalidate: () => undefined,
      };
    }, { overlay: true, overlayOptions: { nonCapturing: true, visible: () => false } });
  });
}
`;

const piOutfitterPrefillExtensionContent = createPiPrefillExtensionContent({
  functionName: 'outfitterSkillPrefill',
  editorText: '/outfitter',
  notification: 'Outfitter is opening /outfitter to help you set up your profile.',
});

const piLoginPrefillExtensionContent = createPiPrefillExtensionContent({
  functionName: 'outfitterLoginPrefill',
  editorText: '/login',
  notification: 'Outfitter is opening /login so you can choose a provider.',
});

const writePiLoginMessage = (writeLine: ((message: string) => void) | undefined, message: string): void => {
  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer for login messages. */
  (writeLine ?? console.log)(message);
};

const shouldAutoOpenOutfitterSkill = (setupResult: SetupCommandResult | undefined, args: readonly string[]): boolean =>
  setupResult?.welcomeResult?.answered === false && !isNonInteractivePiLaunch(args);

const shouldAutoOpenPiLogin = (setupResult: SetupCommandResult | undefined, args: readonly string[]): boolean =>
  setupResult?.welcomeResult !== undefined && !isNonInteractivePiLaunch(args);

const isNonInteractivePiLaunch = (args: readonly string[]): boolean =>
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
