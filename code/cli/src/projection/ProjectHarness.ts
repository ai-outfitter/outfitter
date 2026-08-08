// Projects a harness-neutral CompositionPlan to a native pi, Claude Code, or Codex CLI launch.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PI_SESSION_DIRECTORY_ENV } from '../agents/PiSessionDirectory.js';
import type { CompositionPlan } from '../composer/Composition.js';
import type { Harness } from '../settings/Settings.js';
import { projectCodexMcpServers } from './CodexMcp.js';
import type { MaterializedComposition } from './Materialize.js';
import { materializeComposition, materializeConfigurationOverlays } from './Materialize.js';
import type { AgentLaunchPlan, AgentProjectionPlan, ProjectionInput } from './Projection.js';
import { toolArgs } from './Tools.js';

// Loadout elements a projection actually maps to native config. Anything else is reported
// unsupported so `--strict` catches silently-dropped selections. Baseline for pi and Claude is
// identity + skills + model + thinking + tools. Both harnesses express an allowlist and a denylist
// natively, so `tools` is unconditionally supported; a name projection cannot carry is a hard error
// from `toolArgs`, not an unsupported element. Pi also projects selected subagents and MCP servers
// into its runtime config directory, and projects `extensions` once the run path has resolved their
// install dirs (`extensionLoadDirs`). Claude projects selected MCP servers through an explicit,
// isolated `--mcp-config`; plugins remain unsupported pending incremental parity (#183).
// Switched rather than chained so a harness added to `Harness` fails to compile here instead of
// silently inheriting another harness's element set — the exact silent drop this function prevents.
const supportedElements = (input: ProjectionInput): readonly string[] => {
  const baseline = ['identity', 'skills', 'model', 'thinking', 'tools'];
  switch (input.harness) {
    case 'claude':
      return [...baseline, 'mcp'];
    case 'codex':
      return ['model', 'mcp'];
    case 'pi': {
      const pi = [...baseline, 'subagents', 'mcp', 'prompt_template'];
      return input.extensionLoadDirs === undefined ? pi : [...pi, 'extensions'];
    }
  }
};

const loadoutElementsInUse = (composition: CompositionPlan): readonly string[] => {
  const { loadout } = composition;
  const present: string[] = ['identity'];

  if (loadout.skills.length > 0) present.push('skills');
  if (loadout.subagents.length > 0) present.push('subagents');
  if (loadout.extensions.length > 0) present.push('extensions');
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

// Split from the thinking flag so each builder states positively what it emits: codex reports
// `thinking` unsupported, and reporting an element unsupported does not by itself suppress it.
const modelArg = (composition: CompositionPlan, flag: '-m' | '--model'): readonly string[] =>
  composition.loadout.model === undefined ? [] : [flag, composition.loadout.model];

const thinkingArg = (composition: CompositionPlan, harness: Harness): readonly string[] =>
  composition.loadout.thinking === undefined
    ? []
    : [harness === 'pi' ? '--thinking' : '--effort', composition.loadout.thinking];

// MCP overrides lead and pass-through args trail so a pass-through positional (`exec "<prompt>"`)
// stays last, where codex expects its subcommand and prompt.
const buildCodexLaunchPlan = (
  composition: CompositionPlan,
  input: ProjectionInput,
  codexMcpArgs: readonly string[],
): AgentLaunchPlan => ({
  command: 'codex',
  // Codex CLI 0.145.0 lists `-c` and `-m` on both root and `exec --help`; root placement is valid.
  args: [...codexMcpArgs, ...modelArg(composition, '-m'), ...(input.passThroughArgs ?? [])],
  env: {},
});

// Claude's user, project, and plugin MCP sources would otherwise merge into the composition, so the
// generated config is named explicitly and `--strict-mcp-config` suppresses every other layer.
const claudeMcpArgs = (mcpConfigPath: string): readonly string[] => [
  '--mcp-config',
  mcpConfigPath,
  '--strict-mcp-config',
];

const buildPiOrClaudeLaunchPlan = (
  composition: CompositionPlan,
  input: ProjectionInput,
  materialized: MaterializedComposition,
  appendPromptPaths: readonly string[],
): AgentLaunchPlan => {
  const isPi = input.harness === 'pi';
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
      ...modelArg(composition, '--model'),
      ...thinkingArg(composition, input.harness),
      ...(isPi ? [] : claudeMcpArgs(materialized.mcpConfigPath)),
      ...(input.passThroughArgs ?? []),
    ],
    // The projection root is deleted after the run, so pi's default session store (a subdirectory
    // of PI_CODING_AGENT_DIR) would take every transcript with it. A resolved session directory
    // moves the store somewhere durable so `--continue`/`--resume` still find the last conversation.
    env: isPi
      ? {
          PI_CODING_AGENT_DIR: input.rootDirectory,
          ...(input.sessionDirectory === undefined ? {} : { [PI_SESSION_DIRECTORY_ENV]: input.sessionDirectory }),
        }
      : { CLAUDE_CONFIG_DIR: input.rootDirectory },
  };
};

/** Materializes the composition into the runtime root and builds the harness launch plan. */
export const projectComposition = (composition: CompositionPlan, input: ProjectionInput): AgentProjectionPlan => {
  if (input.harness === 'pi') {
    materializeConfigurationOverlays(input.configurationOverlayDirectories ?? [], input.rootDirectory);
  }
  // Materialization runs for every harness so containment and definition diagnostics are reported
  // uniformly. Codex reads none of the generated files — it takes its MCP config in argv and has no
  // config-directory projection yet — but the root is temporary, so the unused writes do not persist.
  const materialized = materializeComposition(composition, input.rootDirectory);
  const unsupported = [
    ...unsupportedElements(composition, input),
    ...materialized.skippedSkills.map((slug) => `skill:${slug} (escaping symlink)`),
    ...materialized.skippedSubagents.map((slug) => `subagent:${slug} (invalid definition)`),
  ];

  if (input.harness === 'codex') {
    const codexMcp = projectCodexMcpServers(composition.loadout.mcp, composition.loadout.mcpServers);
    const launch = buildCodexLaunchPlan(composition, input, codexMcp.args);
    const warnings = [
      ...(input.appendPromptPaths?.length
        ? ['codex adapter does not project supplied append-prompt documents; they will be dropped.']
        : []),
      ...codexMcp.warnings,
    ];
    return { rootDirectory: input.rootDirectory, launch, unsupported, warnings };
  }

  // Caller documents follow the composition's own, so a persona is read against the agent it adopts.
  const launch = buildPiOrClaudeLaunchPlan(composition, input, materialized, [
    ...materialized.appendPromptPaths,
    ...(input.appendPromptPaths ?? []),
  ]);

  return { rootDirectory: input.rootDirectory, launch, unsupported, warnings: [] };
};
