// Declares where each supported coding harness keeps its user-global configuration, and which of
// those surfaces Outfitter can manage. This registry is the single source of truth for `outfitter
// link`; it is deliberately independent of the temporary `outfitter run` projection (#187), which
// assembles a throwaway runtime directory instead of writing into harness-owned locations.
//
// Every surface here was verified against an installed CLI rather than inferred: Claude Code
// 2.1.220, Codex 0.145.0, Gemini CLI 0.52.0, and GitHub Copilot CLI 1.0.61. All four discover
// skills as `<config>/skills/<slug>/SKILL.md` with YAML frontmatter, so skills project as plain
// per-skill symlinks. The formats that genuinely differ are commands (Gemini uses TOML) and hooks
// (each harness names the same event differently), and those get real adapters.
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Coding harnesses `outfitter link` can provision.
 *
 * Pi is deliberately absent. Outfitter owns Pi's runtime configuration directly through
 * `PI_CODING_AGENT_DIR`, which `outfitter run` assembles per launch, so Pi has no user-global
 * config Outfitter would need to link into. Persistent Pi projection, if it is ever wanted, is a
 * different design and stays with #187 rather than being claimed here.
 */
export const HARNESS_IDS = ['claude', 'codex', 'gemini', 'copilot'] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const isHarnessId = (value: string): value is HarnessId => (HARNESS_IDS as readonly string[]).includes(value);

/** Catalog resource families a harness surface can receive. */
export const LINKABLE_KINDS = ['skills', 'commands', 'instructions', 'hooks'] as const;
export type LinkableKind = (typeof LINKABLE_KINDS)[number];

export const isLinkableKind = (value: string): value is LinkableKind =>
  (LINKABLE_KINDS as readonly string[]).includes(value);

/**
 * How a resource reaches its harness location.
 *
 * `symlink` points a managed leaf at the catalog so edits are live with no reconcile step.
 * `generate` writes a translated file because the harness format is not the catalog format.
 * `settings` merges into an existing harness settings document rather than owning a whole path.
 */
export type LinkStrategy = 'symlink' | 'generate' | 'settings';

export interface HarnessSurface {
  readonly kind: LinkableKind;
  readonly strategy: LinkStrategy;
  /**
   * Path of the surface relative to the harness config directory. A directory for per-resource
   * kinds (`skills`, `commands`), a file for whole-file kinds (`instructions`, `hooks`).
   */
  readonly location: string;
  /** Extension for `generate`d leaves, e.g. Gemini's TOML commands. Unused by other strategies. */
  readonly extension?: string;
}

export interface HarnessLayout {
  readonly id: HarnessId;
  readonly displayName: string;
  /** Config directory relative to the user's home, e.g. `.claude`. */
  readonly configDirectory: string;
  readonly surfaces: readonly HarnessSurface[];
}

/**
 * Registry of harness layouts.
 *
 * A kind absent from a harness's `surfaces` is *not supported* for that harness. `outfitter link`
 * reports it rather than guessing at a location, so the support matrix cannot overstate coverage.
 */
export const HARNESS_LAYOUTS: readonly HarnessLayout[] = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    configDirectory: '.claude',
    surfaces: [
      { kind: 'skills', strategy: 'symlink', location: 'skills' },
      { kind: 'commands', strategy: 'symlink', location: 'commands', extension: '.md' },
      { kind: 'instructions', strategy: 'symlink', location: 'CLAUDE.md' },
      { kind: 'hooks', strategy: 'settings', location: 'settings.json' },
    ],
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    configDirectory: '.codex',
    // Codex reads custom prompts from `prompts/`, not `commands/`, and its instructions file is
    // AGENTS.md. Its hooks are configured inside `config.toml` behind a separate trust prompt, so
    // Outfitter does not write them: silently trusting a hook on the user's behalf is exactly the
    // kind of change #187 requires explicit approval for.
    surfaces: [
      { kind: 'skills', strategy: 'symlink', location: 'skills' },
      { kind: 'commands', strategy: 'symlink', location: 'prompts', extension: '.md' },
      { kind: 'instructions', strategy: 'symlink', location: 'AGENTS.md' },
    ],
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    configDirectory: '.gemini',
    // Gemini custom commands are TOML documents with `description` and `prompt` keys, so a symlink
    // to a Markdown command would not load. They are generated instead.
    surfaces: [
      { kind: 'skills', strategy: 'symlink', location: 'skills' },
      { kind: 'commands', strategy: 'generate', location: 'commands', extension: '.toml' },
      { kind: 'instructions', strategy: 'symlink', location: 'GEMINI.md' },
      { kind: 'hooks', strategy: 'settings', location: 'settings.json' },
    ],
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    configDirectory: '.copilot',
    // Copilot CLI discovers `~/.copilot/skills/<slug>/SKILL.md`. It loads custom instructions from
    // AGENTS.md "and related files", but that discovery is repository-scoped rather than a
    // documented user-global path, and it exposes no hook or custom-command surface, so only
    // skills are claimed here.
    surfaces: [{ kind: 'skills', strategy: 'symlink', location: 'skills' }],
  },
];

const layoutsById: ReadonlyMap<HarnessId, HarnessLayout> = new Map(
  HARNESS_LAYOUTS.map((layout) => [layout.id, layout]),
);

export const findHarnessLayout = (id: HarnessId): HarnessLayout => layoutsById.get(id)!;

export const findHarnessSurface = (layout: HarnessLayout, kind: LinkableKind): HarnessSurface | undefined =>
  layout.surfaces.find((surface) => surface.kind === kind);

/** Kinds a harness supports, in registry order, for support-matrix reporting. */
export const supportedKinds = (layout: HarnessLayout): readonly LinkableKind[] =>
  layout.surfaces.map((surface) => surface.kind);

/**
 * Default config directory for a harness. Injected `homeDirectory` keeps resolution pure; the
 * `homedir()` fallback exists only for direct CLI use.
 */
export const resolveHarnessConfigDirectory = (layout: HarnessLayout, homeDirectory: string = homedir()): string =>
  join(homeDirectory, layout.configDirectory);
