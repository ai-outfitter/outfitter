// Projects the loadout `tools` element ({allow?, deny?}) to native pi and Claude Code launch flags.
import type { Loadout } from '../resolver/Resource.js';
import type { Harness } from '../settings/Settings.js';

/** The `{allow?, deny?}` tool selection carried by a loadout. */
export type ToolSelection = NonNullable<Loadout['tools']>;

/**
 * The effective tool allowlist: `allow` minus `deny`, per OFTR-003.10.4 ("denied tools MUST win
 * when projected"). `undefined` and `[]` mean different things and callers must keep them apart:
 * `undefined` is "no allowlist declared", `[]` is "an allowlist that `deny` emptied".
 */
export const effectiveToolAllowlist = (tools: Loadout['tools']): readonly string[] | undefined => {
  const denied = new Set(tools?.deny ?? []);
  return tools?.allow?.filter((tool) => !denied.has(tool));
};

/**
 * pi and Claude Code both restrict tools, but they restrict *different things*. Verified against
 * pi 0.x and Claude Code 2.1.x:
 *
 * | | pi | claude |
 * | allowlist | `--no-builtin-tools --tools a,b,c` (comma-joined) | `--allowedTools a b c` (variadic) |
 * | denylist | no flag exists | `--disallowedTools a b c` (variadic) |
 * | semantics | **availability**: the tool is not in the session | **permission**: the tool is in the session; the flag decides whether use needs approval |
 *
 * The asymmetry is invisible at the config layer, and `tools` is the field a profile reaches for to
 * keep an agent away from a shell. On pi that shell is gone. On Claude the shell is still there and
 * the flag only pre-approves the listed tools; any other tool prompts, and what an unattended
 * session does with a prompt is not something this projection can guarantee. Read a `tools`
 * allowlist as a hard ceiling on pi and as a permission profile on Claude. Do not rely on the
 * Claude side as a security boundary until the non-interactive denial path is verified.
 *
 * Four rules follow from the flags themselves:
 *
 * - `--no-builtin-tools` is REQUIRED on pi whenever `allow` is set. Without it `--tools` only adds
 *   to the builtin set, so the allowlist restricts nothing.
 * - A deny-only selection has no pi form. pi has no deny flag, and the builtin tool list is not
 *   knowable at projection time, so it cannot be inverted into an allowlist. That case stays
 *   unsupported (see `toolsProjectable`) instead of being silently dropped: for a security control,
 *   fatal under `--strict` is better than quietly unrestricted.
 * - On Claude, `deny` is ALWAYS emitted, including when `allow` is also set. Removing a denied tool
 *   from the allowlist is not enough there: absence from `--allowedTools` only means "using it
 *   needs approval", so the exclusion would rest on the same unverified prompt path. `deny` is a
 *   requirement that denied tools win when projected (OFTR-003.10.4), and only `--disallowedTools`
 *   states it without depending on that path. On pi the filter alone is sufficient, because a tool
 *   left out of `--tools` does not exist.
 * - Claude's flags are variadic. They consume every following token until the next `--flag`, so
 *   these args must stay ahead of a flag-bearing group in the launch plan and must never sit
 *   immediately before pass-through positionals, which would be eaten as tool names. Emitting
 *   `--allowedTools` before `--disallowedTools` terminates the first; the launch plan places the
 *   whole group ahead of the prompt flags, which terminates the second.
 */
export const toolArgs = (harness: Harness, tools: ToolSelection): readonly string[] => {
  const allow = effectiveToolAllowlist(tools);
  const deny = tools.deny ?? [];

  if (harness === 'pi') {
    // A deny-only selection has no pi form; `toolsProjectable` reports it unsupported.
    if (allow === undefined) return [];
    // An allowlist emptied by `deny` is still a request: zero tools, not "no restriction".
    return allow.length === 0 ? ['--no-builtin-tools'] : ['--no-builtin-tools', '--tools', allow.join(',')];
  }

  return [
    // An allowlist emptied by `deny` drops `--allowedTools` entirely, because Claude has no
    // "deny everything" form: an empty list is not accepted as one and there is no counterpart to
    // `--no-builtin-tools`. All that survives is the explicit `--disallowedTools` below. A
    // fully-emptied allowlist on Claude is therefore NOT equivalent to pi's zero-tool session; it
    // denies exactly the named tools and leaves the rest of the builtin set present.
    ...(allow === undefined || allow.length === 0 ? [] : ['--allowedTools', ...allow]),
    ...(deny.length === 0 ? [] : ['--disallowedTools', ...deny]),
  ];
};

/**
 * Whether the harness can express this tool selection natively. Every selection is projectable
 * except a deny-only one on pi, which has no native form (see `toolArgs`).
 */
export const toolsProjectable = (harness: Harness, tools: ToolSelection): boolean =>
  harness !== 'pi' || tools.allow !== undefined;
