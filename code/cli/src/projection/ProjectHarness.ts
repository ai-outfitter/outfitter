// Projects a harness-neutral CompositionPlan to a native pi, Claude Code, or Codex CLI launch.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PI_SESSION_DIRECTORY_ENV } from '../agents/PiSessionDirectory.js';
import type { CompositionPlan } from '../composer/Composition.js';
import type { Harness, Isolation, SettingsValue } from '../settings/Settings.js';
import { projectCodexMcpServers } from './CodexMcp.js';
import type { MaterializedComposition } from './Materialize.js';
import type { ProjectedModel } from './ModelProjection.js';
import { projectModel } from './ModelProjection.js';
import {
  applyPiRuntimeDefaults,
  applyJsonSettingsDefaults,
  materializeComposition,
  materializeConfigurationOverlays,
  writeClaudePluginManifest,
} from './Materialize.js';
import type { AgentLaunchPlan, AgentProjectionPlan, ProjectionInput } from './Projection.js';
import { toolArgs } from './Tools.js';

/**
 * Inheriting is the default: a profile is a costume over the user's own harness, not a replacement
 * machine. Only claude has an inherit path today, so pi and codex resolve to their existing
 * projection-rooted launch whatever the setting says.
 */
const resolveProjectionIsolation = (input: ProjectionInput): Isolation =>
  input.harness === 'claude' ? (input.isolation ?? 'inherit') : 'isolated';

// Loadout elements a projection actually maps to native config. Anything else is reported
// unsupported so `--strict` catches silently-dropped selections. Baseline for pi and Claude is
// identity + skills + model + thinking + tools. Both harnesses express an allowlist and a denylist
// natively, so `tools` is unconditionally supported; a name projection cannot carry is a hard error
// from `toolArgs`, not an unsupported element. Pi also projects selected subagents and MCP servers
// into its runtime config directory, and loads pi extensions from the install dirs the run path
// resolves (`extensionLoadDirs`). Claude projects selected MCP servers through an explicit
// `--mcp-config` and reads materialized subagents from the runtime root in both isolation modes;
// plugins remain unsupported pending incremental parity (#183).
// Switched rather than chained so a harness added to `Harness` fails to compile here instead of
// silently inheriting another harness's element set — the exact silent drop this function prevents.
const supportedElements = (input: ProjectionInput): readonly string[] => {
  const baseline = ['identity', 'skills', 'model', 'thinking', 'tools'];
  switch (input.harness) {
    case 'claude':
      return [...baseline, 'subagents', 'mcp'];
    case 'codex':
      return ['model', 'mcp'];
    case 'pi':
      return [...baseline, 'subagents', 'mcp', 'prompt_template'];
  }
};

const loadoutElementsInUse = (composition: CompositionPlan): readonly string[] => {
  const { loadout } = composition;
  const present: string[] = ['identity'];

  if (loadout.skills.length > 0) present.push('skills');
  if (loadout.subagents.length > 0) present.push('subagents');
  // `extensions` is deliberately absent. It names pi extension packages, so on claude or codex it
  // can only ever be unsupported — there is no setting a user could change to make it project, and
  // no launch they would have wanted instead. Reporting it describes Outfitter's internals rather
  // than a choice the user made, and under `--strict` it would fail every non-pi launch of any
  // agent that carries extensions at all. Extension resolution and install failures still surface
  // from the run path, which is where a user can act on them.
  if (loadout.plugins.length > 0) present.push('plugins');
  if (loadout.mcp.length > 0) present.push('mcp');
  if (loadout.model !== undefined) present.push('model');
  if (loadout.thinking !== undefined) present.push('thinking');
  if (loadout.tools !== undefined) present.push('tools');
  if (composition.identity.promptTemplate !== undefined) present.push('prompt_template');

  return present;
};

export const unsupportedElements = (composition: CompositionPlan, input: ProjectionInput): readonly string[] =>
  loadoutElementsInUse(composition).filter((element) => !supportedElements(input).includes(element));

/**
 * The two harnesses take prompt documents through incompatible flags, verified against pi 0.x via
 * `outfitter run` and Claude Code 2.1.x directly:
 *
 * | | pi | claude |
 * | `--system-prompt <path>` / `--append-system-prompt <path>` | reads the file | appends the path *text* |
 * | `--system-prompt-file` / `--append-system-prompt-file` | rejected: `Unknown option` | reads the file |
 * | repeated append flags | accumulate | last one wins |
 *
 * pi therefore takes paths on the bare flags, and Claude takes the `-file` forms. Claude's are
 * undocumented — neither appears in `claude --help` — but both apply the file's contents, while the
 * bare flags silently append the path string and drop the document. Getting this wrong produces no
 * error, just an agent launched without its identity.
 *
 * Claude also gets a single append flag over a concatenation, because repeats overwrite.
 */
const promptPathArg = (harness: Harness, flag: 'system-prompt' | 'append-system-prompt'): string =>
  harness === 'pi' ? `--${flag}` : `--${flag}-file`;

const appendPromptArgs = (harness: Harness, rootDirectory: string, paths: readonly string[]): readonly string[] => {
  /* v8 ignore next 2 -- unreachable through composition, which always contributes the agent body;
     kept because projectComposition is exported and an empty list must not name an empty file. */
  if (paths.length === 0) return [];
  if (harness === 'pi') return paths.flatMap((path) => ['--append-system-prompt', path]);

  const combinedPath = join(rootDirectory, 'append-system-prompt.md');
  // A blank line between documents: one newline would let a document that ends mid-sentence merge
  // into the next one's opening paragraph, or turn it into a setext heading.
  const documents = paths.map((path) => readFileSync(path, 'utf8').replace(/\n*$/, '\n'));
  writeFileSync(combinedPath, documents.join('\n'));
  return [promptPathArg(harness, 'append-system-prompt'), combinedPath];
};

const promptArgs = (
  composition: CompositionPlan,
  input: ProjectionInput,
  systemPromptPath: string,
  appendPromptPaths: readonly string[],
): readonly string[] => [
  promptPathArg(input.harness, 'system-prompt'),
  systemPromptPath,
  ...appendPromptArgs(input.harness, input.rootDirectory, appendPromptPaths),
  ...(input.harness === 'pi' && composition.identity.promptTemplate !== undefined
    ? ['--prompt-template', `${input.rootDirectory}/prompt-template.md`]
    : []),
];

const thinkingArg = (composition: CompositionPlan, harness: Harness): readonly string[] =>
  composition.loadout.thinking === undefined
    ? []
    : [harness === 'pi' ? '--thinking' : '--effort', composition.loadout.thinking];

const codexKeySegment = (key: string): string => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key));

const codexValue = (value: SettingsValue): string | undefined => {
  if (value === null) return undefined;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const values = value.map(codexValue);
    return values.every((item) => item !== undefined) ? `[${values.join(', ')}]` : undefined;
  }
  return undefined;
};

const projectCodexDefaults = (
  defaults: Readonly<Record<string, SettingsValue>> | undefined,
): { readonly args: readonly string[]; readonly warnings: readonly string[] } => {
  const args: string[] = [];
  const warnings: string[] = [];
  const visit = (value: SettingsValue, path: readonly string[]): void => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) visit(child, [...path, key]);
      return;
    }
    const encoded = codexValue(value);
    const key = path.map(codexKeySegment).join('.');
    if (encoded === undefined) warnings.push(`codex harness default '${key}' cannot be represented as TOML.`);
    else args.push('--config', `${key}=${encoded}`);
  };
  for (const [key, value] of Object.entries(defaults ?? {})) visit(value, [key]);
  return { args, warnings };
};

// MCP overrides lead and pass-through args trail so a pass-through positional (`exec "<prompt>"`)
// stays last, where codex expects its subcommand and prompt.
const buildCodexLaunchPlan = (
  input: ProjectionInput,
  defaultArgs: readonly string[],
  codexMcpArgs: readonly string[],
  model: ProjectedModel,
): AgentLaunchPlan => ({
  command: 'codex',
  // Root `-m` propagation through `exec` was verified empirically on codex-cli 0.145.0.
  args: [...defaultArgs, ...codexMcpArgs, ...model.args, ...(input.passThroughArgs ?? [])],
  env: model.env,
});

/**
 * An isolated run names the generated config explicitly and lets `--strict-mcp-config` suppress
 * every other layer, so the composition is the whole MCP surface. An inherited run drops the strict
 * flag: a profile selecting a server states what it needs, not what the user may not have, so
 * Claude merges the composition with the servers already configured on the machine.
 */
const claudeMcpArgs = (mcpConfigPath: string, isolation: Isolation): readonly string[] => [
  '--mcp-config',
  mcpConfigPath,
  ...(isolation === 'isolated' ? ['--strict-mcp-config'] : []),
];

/**
 * Claude reads a composition either as its whole configuration directory or as one session-scoped
 * plugin. `CLAUDE_CONFIG_DIR` replaces the user's `~/.claude` wholesale — trust, permissions,
 * credentials, plugins and all — which is why an isolated run has to seed durable state back into
 * the projection to be usable at all. `--plugin-dir` carries the same materialized tree (skills,
 * subagents, commands) into a session that is otherwise entirely the user's own, so nothing needs
 * seeding and nothing needs copying back. Verified against Claude Code 2.1.226: a plugin directory
 * loads skills unnamespaced, and commands and subagents under the plugin's name.
 */
const claudeConfigArgs = (
  rootDirectory: string,
  isolation: Isolation,
  settingsPath: string | undefined,
): readonly string[] => [
  ...(isolation === 'isolated' ? [] : ['--plugin-dir', rootDirectory]),
  ...(settingsPath === undefined ? [] : ['--settings', settingsPath]),
];

const claudeArgs = (rootDirectory: string, isolation: Isolation, settingsPath?: string): readonly string[] => [
  ...claudeConfigArgs(rootDirectory, isolation, settingsPath),
  ...claudeMcpArgs(join(rootDirectory, 'mcp.json'), isolation),
];

const claudeEnv = (rootDirectory: string, isolation: Isolation): Readonly<Record<string, string>> =>
  isolation === 'isolated' ? { CLAUDE_CONFIG_DIR: rootDirectory } : {};

/**
 * An inherited Claude run reaches the composition through `--plugin-dir`, which needs the runtime
 * root to declare itself a plugin. Called after materialization so it survives the subagent
 * directory rebuild.
 */
const declareClaudePlugin = (composition: CompositionPlan, input: ProjectionInput): void => {
  if (resolveProjectionIsolation(input) !== 'inherit') return;
  writeClaudePluginManifest(input.rootDirectory, input.profileSlug ?? 'outfitter', composition.identity.label);
};

const buildPiOrClaudeLaunchPlan = (
  composition: CompositionPlan,
  input: ProjectionInput,
  materialized: MaterializedComposition,
  appendPromptPaths: readonly string[],
  model: ProjectedModel,
  settingsPath?: string,
): AgentLaunchPlan => {
  const isPi = input.harness === 'pi';
  const isolation = resolveProjectionIsolation(input);
  const skillArgs = isPi ? composition.loadout.skills.flatMap((skill) => ['--skill', skill.slug]) : [];
  const extensionArgs = isPi ? (input.extensionLoadDirs ?? []).flatMap((dir) => ['--extension', dir]) : [];

  return {
    command: isPi ? 'pi' : 'claude',
    args: [
      // Tool args lead the list on purpose: Claude's `--allowedTools`/`--disallowedTools` are
      // variadic and stop only at the next `--flag`, and the prompt args that follow always start
      // with one. Placed later they could swallow a pass-through positional. See Tools.ts.
      ...(composition.loadout.tools === undefined ? [] : toolArgs(input.harness, composition.loadout.tools)),
      ...promptArgs(composition, input, materialized.systemPromptPath, appendPromptPaths),
      ...skillArgs,
      ...extensionArgs,
      ...model.args,
      ...thinkingArg(composition, input.harness),
      ...(isPi ? [] : claudeArgs(input.rootDirectory, isolation, settingsPath)),
      ...(input.passThroughArgs ?? []),
    ],
    // The projection root is deleted after the run, so pi's default session store (a subdirectory
    // of PI_CODING_AGENT_DIR) would take every transcript with it. A resolved session directory
    // moves the store somewhere durable so `--continue`/`--resume` still find the last conversation.
    env: isPi
      ? {
          PI_CODING_AGENT_DIR: input.rootDirectory,
          ...(input.sessionDirectory === undefined ? {} : { [PI_SESSION_DIRECTORY_ENV]: input.sessionDirectory }),
          ...model.env,
        }
      : { ...claudeEnv(input.rootDirectory, isolation), ...model.env },
  };
};

interface PreparedHarnessDefaults {
  readonly warnings: readonly string[];
  readonly claudeSettingsPath?: string;
  readonly codexArgs: readonly string[];
}

const prepareHarnessDefaults = (input: ProjectionInput): PreparedHarnessDefaults => {
  const defaultWarnings: string[] = [];
  if (input.harness === 'pi') {
    materializeConfigurationOverlays(input.configurationOverlayDirectories ?? [], input.rootDirectory);
    const settingsPath = applyJsonSettingsDefaults(input.rootDirectory, input.harnessDefaults);
    if (
      input.harnessDefaults !== undefined &&
      Object.keys(input.harnessDefaults).length > 0 &&
      settingsPath === undefined
    )
      defaultWarnings.push('pi harness defaults could not be merged because settings.json is not a JSON object.');
    applyPiRuntimeDefaults(input.rootDirectory);
  }
  const claudeSettingsPath =
    input.harness === 'claude' ? applyJsonSettingsDefaults(input.rootDirectory, input.harnessDefaults) : undefined;
  const codex = input.harness === 'codex' ? projectCodexDefaults(input.harnessDefaults) : undefined;
  if (codex !== undefined) defaultWarnings.push(...codex.warnings);
  return { warnings: defaultWarnings, claudeSettingsPath, codexArgs: codex === undefined ? [] : codex.args };
};

/** Materializes the composition into the runtime root and builds the harness launch plan. */
export const projectComposition = (composition: CompositionPlan, input: ProjectionInput): AgentProjectionPlan => {
  const defaults = prepareHarnessDefaults(input);
  // Materialization runs for every harness so containment and definition diagnostics are reported
  // uniformly. Codex reads none of the generated files — it takes its MCP config in argv and has no
  // config-directory projection yet — but the root is temporary, so the unused writes do not persist.
  const materialized = materializeComposition(composition, input.rootDirectory, input.harness);

  declareClaudePlugin(composition, input);
  const projectedModel = projectModel(composition, input);

  const unsupported = [
    ...unsupportedElements(composition, input),
    ...materialized.skippedSkills.map((slug) => `skill:${slug} (escaping symlink)`),
    ...materialized.skippedSubagents.map((slug) => `subagent:${slug} (invalid definition)`),
  ];

  if (input.harness === 'codex') {
    const codexMcp = projectCodexMcpServers(composition.loadout.mcp, composition.loadout.mcpServers);
    const launch = buildCodexLaunchPlan(input, defaults.codexArgs, codexMcp.args, projectedModel);
    const warnings = [
      ...(input.appendPromptPaths?.length
        ? ['codex adapter does not project supplied append-prompt documents; they will be dropped.']
        : []),
      ...codexMcp.warnings,
      ...defaults.warnings,
      ...projectedModel.warnings,
    ];
    return { rootDirectory: input.rootDirectory, launch, unsupported, warnings };
  }

  // Caller documents follow the composition's own, so a persona is read against the agent it adopts.
  const launch = buildPiOrClaudeLaunchPlan(
    composition,
    input,
    materialized,
    [...materialized.appendPromptPaths, ...(input.appendPromptPaths ?? [])],
    projectedModel,
    defaults.claudeSettingsPath,
  );

  return {
    rootDirectory: input.rootDirectory,
    launch,
    unsupported,
    warnings: [...defaults.warnings, ...projectedModel.warnings],
  };
};
