// Selects a synchronized native profile or copies a prebuilt tree; never resolves source inputs.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PI_SESSION_DIRECTORY_ENV } from '../../agents/PiSessionDirectory.js';
import { resolveHarnessHome } from '../../links/HarnessHome.js';
import { copyCompiledLaunch } from '../../profiles/CompiledLaunch.js';
import type { CompiledProfile, CompiledRegistry } from '../../profiles/CompiledRegistry.js';
import { nativeProfileName, profileProjectionStatus } from '../../profiles/NativeProfiles.js';
import { projectModel } from '../../projection/ModelProjection.js';
import type { AgentLaunchPlan } from '../../projection/Projection.js';
import type { Harness, Isolation } from '../../settings/Settings.js';
import { attachSystemExtensionHooks } from '../../system/SystemExtensionHook.js';
import { attachPiRuntimeExtension } from './PiRuntimeLaunch.js';
import type { RunAgentInput, RunAgentResult } from './RunAgentCommand.js';

export interface CompiledRunRuntime {
  readonly harness: Harness;
  readonly isolation: Isolation;
  readonly sessionDirectory?: string;
  readonly extensions: (specs: readonly string[]) => Promise<{
    readonly loadDirs: readonly string[];
    readonly warnings: readonly string[];
  }>;
  readonly notices: (rootDirectory: string) => readonly string[];
  readonly launch: (
    rootDirectory: string,
    launch: AgentLaunchPlan,
    messages: string[],
    persistPiModels: boolean,
  ) => Promise<number>;
}

const selectProfile = (input: RunAgentInput, registry: CompiledRegistry): CompiledProfile => {
  const slug = input.agent ?? registry.settings.defaultAgent;
  const profile = registry.profiles.find((candidate) => candidate.agent === slug);
  if (profile === undefined)
    throw new Error(`Agent '${slug ?? '(default)'}' is not compiled. Enable it and run 'outfitter sync --local'.`);
  return profile;
};

const nativeLaunch = (input: RunAgentInput, profile: CompiledProfile, harness: 'claude' | 'codex'): AgentLaunchPlan => {
  const home = resolveHarnessHome(harness, input.homeDirectory, process.env);
  const marker = join(home, harness === 'claude' ? `agents/${profile.agent}.md` : `${profile.agent}.config.toml`);
  if (!existsSync(marker) || !readFileSync(marker, 'utf8').includes(profile.fingerprint))
    throw new Error(
      `Native ${harness} profile '${profile.agent}' is not current. Run 'outfitter sync --harness ${harness}'.`,
    );
  return {
    command: harness,
    args: [harness === 'claude' ? '--agent' : '--profile', nativeProfileName(profile.agent, harness)],
    env: { [harness === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: home },
  };
};

const prepareLaunch = (
  input: RunAgentInput,
  profile: CompiledProfile,
  runtime: CompiledRunRuntime,
  rootDirectory: string,
  warnings: string[],
): AgentLaunchPlan => {
  const { harness, isolation } = runtime;
  if (harness === 'codex' || (harness === 'claude' && isolation === 'inherit'))
    return nativeLaunch(input, profile, harness);
  const projection = copyCompiledLaunch(profile, harness, rootDirectory);
  warnings.push(...projection.warnings, ...projection.unsupported);
  return projection.launch;
};

const appendCallerPrompts = (
  input: RunAgentInput,
  harness: Harness,
  launch: AgentLaunchPlan,
  rootDirectory: string,
  warnings: string[],
): AgentLaunchPlan => {
  if (input.appendPromptPaths === undefined || input.appendPromptPaths.length === 0 || harness === 'pi') return launch;
  if (harness === 'codex') {
    warnings.push('codex adapter does not project supplied append-prompt documents.');
    return launch;
  }
  const path = join(rootDirectory, 'caller-prompt.md');
  const index = launch.args.indexOf('--append-system-prompt-file');
  const inherited = index < 0 ? [] : [launch.args[index + 1]];
  writeFileSync(
    path,
    [...inherited, ...input.appendPromptPaths].map((file) => readFileSync(file, 'utf8')).join('\n\n'),
  );
  return {
    ...launch,
    args: [
      ...launch.args.filter((_arg, position) => index < 0 || (position !== index && position !== index + 1)),
      '--append-system-prompt-file',
      path,
    ],
  };
};

const finishLaunch = async (
  input: RunAgentInput,
  registry: CompiledRegistry,
  profile: CompiledProfile,
  runtime: CompiledRunRuntime,
  rootDirectory: string,
  launch: AgentLaunchPlan,
  warnings: string[],
): Promise<RunAgentResult> => {
  if (input.strict === true && warnings.length > 0) {
    const messages = [...warnings, 'Strict mode: composition warnings and unsupported elements are fatal.'];
    for (const message of messages) input.writeLine?.(message);
    return { exitCode: 1, messages };
  }
  const extension = attachPiRuntimeExtension(launch, {
    profile: { id: profile.agent, label: profile.plan.identity.label },
    rootDirectory,
    registry,
    appendPromptPaths: input.appendPromptPaths,
    providerPrompt: input.providerPromptSkipped === true ? 'hint' : 'dialog',
  });
  const hooks = attachSystemExtensionHooks(extension);
  const messages = [...warnings, ...runtime.notices(rootDirectory), ...hooks.warnings];
  for (const message of messages) input.writeLine?.(message);
  const exitCode = await runtime.launch(
    rootDirectory,
    hooks.launch,
    messages,
    profile.plan.models?.configured !== true,
  );
  return { launchPlan: hooks.launch, exitCode, messages };
};

const launchProfile = async (
  input: RunAgentInput,
  registry: CompiledRegistry,
  profile: CompiledProfile,
  runtime: CompiledRunRuntime,
  rootDirectory: string,
): Promise<RunAgentResult> => {
  const { harness } = runtime;
  const status = profileProjectionStatus(profile, harness, registry.profiles);
  const warnings = [
    ...profile.plan.warnings,
    ...status.unsupported.map((field) => `harness '${harness}' cannot project loadout element '${field}'.`),
  ];
  let launch = prepareLaunch(input, profile, runtime, rootDirectory, warnings);
  const model = projectModel(profile.plan, {
    harness,
    rootDirectory,
    homeDirectory: input.homeDirectory,
    processEnvironment: process.env,
  });
  const extensions = await runtime.extensions(profile.plan.loadout.extensions);
  warnings.push(...model.warnings, ...extensions.warnings);
  launch = appendCallerPrompts(input, harness, launch, rootDirectory, warnings);
  launch = {
    ...launch,
    args: [
      ...launch.args,
      ...extensions.loadDirs.flatMap((directory) => ['--extension', directory]),
      ...(harness === 'pi' ? [] : model.args),
      ...(input.passThroughArgs ?? []),
    ],
    env: {
      ...launch.env,
      ...model.env,
      ...(runtime.sessionDirectory === undefined ? {} : { [PI_SESSION_DIRECTORY_ENV]: runtime.sessionDirectory }),
    },
  };
  return finishLaunch(input, registry, profile, runtime, rootDirectory, launch, warnings);
};

export const executeCompiledRun = async (
  input: RunAgentInput,
  registry: CompiledRegistry,
  runtime: CompiledRunRuntime,
): Promise<RunAgentResult> => {
  const profile = selectProfile(input, registry);
  const rootDirectory = mkdtempSync(join(tmpdir(), `outfitter-${profile.agent}-${runtime.harness}-`));
  try {
    return await launchProfile(input, registry, profile, runtime, rootDirectory);
  } finally {
    if (input.retainProjection !== true) rmSync(rootDirectory, { recursive: true, force: true });
  }
};
