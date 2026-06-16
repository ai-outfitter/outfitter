// Adds first-run Pi login startup behavior without handling credentials in ApplePi.
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

const manualLoginMessage =
  'Pi does not appear to be logged in yet. After Pi starts, run `/login` and choose a subscription such as Codex or provide an API key from another model provider.';

const automaticLoginMessage =
  'Pi does not appear to be logged in yet. ApplePi will open `/login` automatically after Pi starts.';

const nonInteractivePiLaunchFlags = new Set(['--print', '-p', '--mode', '--export', '--list-models']);

export const preparePiLoginLaunchPlan = (input: PiLoginLaunchPlanInput): AgentLaunchPlan => {
  if (input.adapterId !== 'pi' || hasConfiguredPiLoginState(input.homeDirectory)) {
    return input.launchPlan;
  }

  if (shouldAutoOpenPiLogin(input.setupResult, input.launchPlan.args)) {
    writePiLoginMessage(input.writeLine, automaticLoginMessage);
    return addPiLoginPrefillExtension(input.launchPlan);
  }

  writePiLoginMessage(input.writeLine, manualLoginMessage);
  return input.launchPlan;
};

const addPiLoginPrefillExtension = (launchPlan: AgentLaunchPlan): AgentLaunchPlan => {
  const extensionPath = join(launchPlan.env.PI_CODING_AGENT_DIR, 'applepi', 'prefill-login-extension.js');
  mkdirSync(dirname(extensionPath), { recursive: true });
  writeFileSync(extensionPath, piLoginPrefillExtensionContent);

  return { ...launchPlan, args: ['--extension', extensionPath, ...launchPlan.args] };
};

const piLoginPrefillExtensionContent = `export default function applePiLoginPrefill(pi) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setEditorText("/login");
    ctx.ui.notify("ApplePi is opening /login so you can choose a provider.", "info");
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
