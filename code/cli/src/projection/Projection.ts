// Harness-neutral projection types: a materialized runtime tree plus the launch plan for one run.
import type { Harness, HarnessDefaultSettings, Isolation } from '../settings/Settings.js';

export interface AgentLaunchPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface AgentProjectionPlan {
  /** Absolute path to the materialized runtime configuration root for this run. */
  readonly rootDirectory: string;
  readonly launch: AgentLaunchPlan;
  /** Composition elements the selected harness cannot project. */
  readonly unsupported: readonly string[];
  /** Adapter limitations or malformed native configuration discovered during projection. */
  readonly warnings: readonly string[];
}

export interface ProjectionInput {
  readonly harness: Harness;
  readonly rootDirectory: string;
  readonly homeDirectory: string;
  /** Runtime credential values used only when a harness requires an environment-variable alias. */
  readonly processEnvironment?: Readonly<Record<string, string | undefined>>;
  /**
   * Whether the launch stands on the machine's native harness configuration (claude only; pi and
   * codex have no inherit path yet). Defaults to `inherit`, so a profile layers over the user's own
   * trust, permissions, MCP servers, and plugins instead of replacing them.
   */
  readonly isolation?: Isolation;
  /** Profile slug, which names the generated plugin so its commands and subagents namespace readably. */
  readonly profileSlug?: string;
  /** Durable session store for the run (pi only); omitted to leave the harness default in place. */
  readonly sessionDirectory?: string;
  readonly passThroughArgs?: readonly string[];
  /**
   * Caller-supplied documents appended to the system prompt after the composition's own, in the
   * order given — typically a persona, by absolute path from outside the projection root. Projected
   * per harness, since pi and claude take append-prompt documents through incompatible flags.
   */
  readonly appendPromptPaths?: readonly string[];
  /** Local pi extension install directories to load with `--extension` (pi only). */
  readonly extensionLoadDirs?: readonly string[];
  /**
   * Pi entry-file paths of the cached npm extensions, in declared loadout order and de-duplicated.
   * The pi harness merges them into the generated `settings.json` `extensions:` array — the surface
   * fresh loaders (pi-subagents child sessions, SDK sessions) read — while the `--extension` flags
   * keep driving the main session (pi's loader dedupes the two routes). pi only; every other
   * harness ignores the input.
   */
  readonly extensionSettingsEntries?: readonly string[];
  /** Harness-native configuration directories, highest precedence first, overlaid into the root. */
  readonly configurationOverlayDirectories?: readonly string[];
  /**
   * Settings-layer (`agent_defaults.pi_overlay`) directories, highest-precedence layer first. They
   * sit below the per-agent `configurationOverlayDirectories` and above generated defaults; the pi
   * harness overlays them into the root and every other harness reports them unsupported.
   */
  readonly agentDefaultsOverlayDirectories?: readonly string[];
  /**
   * Settings-layer (`agent_defaults.extension_configs`) file-based extension configurations. The
   * pi harness materializes them as generated `extensions/<name>.json` defaults below the overlay
   * tiers, and every other harness reports them unsupported.
   */
  readonly agentDefaultsExtensionConfigs?: Readonly<Record<string, unknown>>;
  /** Harness-native defaults from the merged Outfitter settings stack. */
  readonly harnessDefaults?: HarnessDefaultSettings;
}
