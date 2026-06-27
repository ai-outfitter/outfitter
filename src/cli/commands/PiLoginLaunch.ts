// Adds first-run Pi login startup behavior without handling credentials in Outfitter.
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

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--mode', '--export', '--list-models']);

export const preparePiLoginLaunchPlan = (input: PiLoginLaunchPlanInput): AgentLaunchPlan => {
  if (input.adapterId !== 'pi') {
    return input.launchPlan;
  }

  // Load the Outfitter runtime extension for every interactive pi session. It brands the
  // startup header today and is the home for future Outfitter↔pi integration. The header
  // text is compiled into pi, so a launch-time extension is the only repo-local override.
  // Non-interactive launches (--print, --export, …) keep pi untouched.
  let launchPlan = input.launchPlan;
  if (!isNonInteractivePiLaunch(input.launchPlan.args)) {
    launchPlan = addExtension(launchPlan, 'outfitter-extension.js', piOutfitterExtensionContent);
  }

  if (!hasConfiguredPiLoginState(input.homeDirectory)) {
    if (shouldAutoOpenPiLogin(input.setupResult, input.launchPlan.args)) {
      writePiLoginMessage(input.writeLine, automaticLoginMessage);
      return addExtension(launchPlan, 'prefill-login-extension.js', piLoginPrefillExtensionContent);
    }

    writePiLoginMessage(input.writeLine, manualLoginMessage);
    return launchPlan;
  }

  if (shouldAutoOpenOutfitterSkill(input.setupResult, input.launchPlan.args)) {
    writePiLoginMessage(input.writeLine, outfitterSkillMessage);
    return addExtension(launchPlan, 'prefill-outfitter-extension.js', piOutfitterPrefillExtensionContent);
  }

  return launchPlan;
};

const addExtension = (launchPlan: AgentLaunchPlan, fileName: string, content: string): AgentLaunchPlan => {
  const extensionPath = join(launchPlan.env.PI_CODING_AGENT_DIR, 'outfitter', fileName);
  mkdirSync(dirname(extensionPath), { recursive: true });
  writeFileSync(extensionPath, content);

  return { ...launchPlan, args: ['--extension', extensionPath, ...launchPlan.args] };
};

// The general Outfitter pi extension. Currently brands the startup header with an
// Outfitter + pi line; extend its session_start handler for further integration.
const piOutfitterExtensionContent = `export default function outfitter(pi) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHeader((_tui, theme) => {
      const lines = [
        theme.bold(theme.fg("accent", "Outfitter")) + theme.fg("dim", " + pi"),
        theme.fg("muted", "/ commands · ! bash · ctrl+o more"),
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
  });
}
`;

const piOutfitterPrefillExtensionContent = `export default function outfitterSkillPrefill(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText("/outfitter");
    ctx.ui.notify("Outfitter is opening /outfitter to help you set up your profile.", "info");
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

const piLoginPrefillExtensionContent = `export default function outfitterLoginPrefill(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText("/login");
    ctx.ui.notify("Outfitter is opening /login so you can choose a provider.", "info");
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

const writePiLoginMessage = (writeLine: ((message: string) => void) | undefined, message: string): void => {
  /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer for login messages. */
  (writeLine ?? console.log)(message);
};

const shouldAutoOpenOutfitterSkill = (setupResult: SetupCommandResult | undefined, args: readonly string[]): boolean =>
  setupResult?.welcomeResult?.answered === false && !isNonInteractivePiLaunch(args);

const shouldAutoOpenPiLogin = (setupResult: SetupCommandResult | undefined, args: readonly string[]): boolean =>
  setupResult?.welcomeResult !== undefined && !isNonInteractivePiLaunch(args);

const isNonInteractivePiLaunch = (args: readonly string[]): boolean =>
  args.some((arg) => nonInteractivePiLaunchFlags.has(arg));

const hasConfiguredPiLoginState = (homeDirectory: string): boolean =>
  hasConfiguredPiStateFile(homeDirectory, 'auth.json') || hasConfiguredPiStateFile(homeDirectory, 'models.json');

const hasConfiguredPiStateFile = (homeDirectory: string, fileName: string): boolean => {
  const statePath = join(homeDirectory, '.pi', 'agent', fileName);

  if (!existsSync(statePath)) {
    return false;
  }

  try {
    return hasConfiguredPiStateEntries(JSON.parse(readFileSync(statePath, 'utf8')));
  } catch {
    return false;
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
