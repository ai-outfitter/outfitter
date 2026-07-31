// The `harnesses:` settings block — the user-facing control surface for `outfitter link`.
//
// This is where a user's own configuration enters the link pipeline. Declaring a harness, an extra
// config directory, or a hook in `~/.agents/settings.yml` is all that is needed; the same
// deterministic precedence as every other Outfitter setting applies (project-local over project
// over user over built-in defaults), so a project can narrow what its checkout provisions without
// editing anything global.
import type { HarnessId, LinkableKind } from './HarnessLayout.js';
import type { HookDeclaration } from './HookAdapter.js';

/**
 * Which harnesses to provision.
 *
 * `detected` — every harness whose config directory already exists. This is the default because it
 * is the only selection that cannot create configuration for a CLI the user has not installed.
 * `none` — link nothing; the escape hatch for a machine that manages links some other way.
 * A list — exactly these harnesses, whether or not their directories exist yet.
 */
export type HarnessSelection = 'detected' | 'none' | readonly HarnessId[];

export interface HarnessOverride {
  /** Include or exclude this harness regardless of what `link` selected. */
  readonly enabled?: boolean;
  /** Restrict provisioning to these kinds. Defaults to every kind the harness supports. */
  readonly resources?: readonly LinkableKind[];
  /**
   * Config directories to provision instead of the harness default. A list because one harness can
   * have several live config roots — Claude Code honours `CLAUDE_CONFIG_DIR`, so a second profile
   * such as `~/.claude-work` is a real directory that would otherwise be silently skipped.
   */
  readonly configDirectories?: readonly string[];
}

export interface HarnessSettings {
  readonly link?: HarnessSelection;
  /** Harness-neutral hooks projected into every selected harness that supports hooks. */
  readonly hooks?: readonly HookDeclaration[];
  readonly overrides?: Readonly<Partial<Record<HarnessId, HarnessOverride>>>;
}

export const emptyHarnessSettings = (): HarnessSettings => ({});

/**
 * Folds a higher-precedence block over a lower one. `link` and `resources` replace wholesale (a
 * project narrowing the selection must not be widened by a user default), while `hooks`
 * concatenate lower-first so a project adds to the user's hooks instead of dropping them.
 */
export const mergeHarnessSettings = (
  lowerPrecedence: HarnessSettings | undefined,
  higherPrecedence: HarnessSettings | undefined,
): HarnessSettings | undefined => {
  if (lowerPrecedence === undefined) return higherPrecedence;
  if (higherPrecedence === undefined) return lowerPrecedence;

  const overrides = mergeOverrides(lowerPrecedence.overrides, higherPrecedence.overrides);
  const hooks = [...(lowerPrecedence.hooks ?? []), ...(higherPrecedence.hooks ?? [])];

  return {
    link: higherPrecedence.link ?? lowerPrecedence.link,
    ...(hooks.length === 0 ? {} : { hooks }),
    ...(overrides === undefined ? {} : { overrides }),
  };
};

type Overrides = Readonly<Partial<Record<HarnessId, HarnessOverride>>>;

/** Per-harness overrides merge field-by-field, so a project can change one field of a user's. */
const mergeOverrides = (
  lowerPrecedence: Overrides | undefined,
  higherPrecedence: Overrides | undefined,
): Overrides | undefined => {
  const ids = new Set<HarnessId>([
    ...(Object.keys(lowerPrecedence ?? {}) as HarnessId[]),
    ...(Object.keys(higherPrecedence ?? {}) as HarnessId[]),
  ]);

  if (ids.size === 0) return undefined;

  const merged: Partial<Record<HarnessId, HarnessOverride>> = {};

  for (const id of ids) {
    merged[id] = { ...lowerPrecedence?.[id], ...higherPrecedence?.[id] };
  }

  return merged;
};
