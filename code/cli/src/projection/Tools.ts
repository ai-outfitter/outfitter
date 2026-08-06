// Projects the loadout `tools` element ({allow?, deny?}) to native pi and Claude Code launch flags.
import type { Loadout } from '../resolver/Resource.js';
import type { Harness } from '../settings/Settings.js';

/** The `{allow?, deny?}` tool selection carried by a loadout. */
export type ToolSelection = NonNullable<Loadout['tools']>;

/**
 * A projectable tool name. Kept in lockstep with `$defs/toolName` in `agent.schema.json`, which
 * rejects the same shapes at the YAML read boundary; a unit test asserts the two stay equal.
 *
 * Three characters are excluded, because projection puts these names into harness argv:
 *
 * - A leading `-` makes the name an independent flag on Claude, where each entry becomes its own
 *   argv element. `allow: [Read, --dangerously-skip-permissions]` would not name a tool. It would
 *   turn off the permission system this element exists to configure. Profiles compose from remote
 *   catalogs and inheritance chains, so a tool name is not always written by the person who runs
 *   the agent, which makes this a supply-chain path to arbitrary launch flags.
 * - A comma splits one name into several entries inside pi's `--tools a,b,c` value.
 * - Whitespace is not a separator on either path today, because no shell is involved and pi gets a
 *   single argv element. It is rejected as conservatism, and it keeps names portable between the
 *   two harnesses. Note that this also excludes Claude's scoped permission rules, such as
 *   `Bash(npm run test:*)`. That is deliberate for a harness-neutral field: the same string is
 *   meaningless to pi. Relaxing the pattern later is backward compatible.
 */
export const TOOL_NAME_PATTERN = /^[^\s,-][^\s,]*$/;

/**
 * Rejects a tool name that projection cannot carry as a name. This throws instead of filtering,
 * because dropping an entry from a security control without saying so is the failure mode this
 * element must not have. A selection that cannot be projected exactly as written must not launch.
 */
const assertProjectableToolNames = (tools: ToolSelection): void => {
  const offending = invalidToolName(tools);

  if (offending !== undefined) {
    throw new Error(`tool name ${JSON.stringify(offending)} cannot be projected: ${TOOL_NAME_RULE}`);
  }
};

/** The rule the pattern encodes, phrased for an error that a profile author reads. */
export const TOOL_NAME_RULE =
  "a tool name must not start with '-' or contain a comma or whitespace, because projection would make it a separate harness flag or split it into several names.";

/**
 * The first tool name in the selection that projection cannot carry, or `undefined` when every name
 * is projectable. Shared with the agent read boundary, so `config.json` overlays, which bypass the
 * JSON Schema, are held to the same invariant.
 */
export const invalidToolName = (tools: Loadout['tools']): string | undefined =>
  [...(tools?.allow ?? []), ...(tools?.deny ?? [])].find((name) => !TOOL_NAME_PATTERN.test(name));

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
 * pi and Claude Code both restrict tools, but they restrict *different things*. The pi rows were
 * measured against pi 0.83.0 with a probe extension that registers a uniquely-named tool and prints
 * `pi.getActiveTools()` at `session_start`; the exact runs are recorded in the PR for #255.
 *
 * | | pi | claude |
 * | allowlist | `--no-tools --tools a,b,c` (comma-joined) | `--allowedTools a b c` (variadic) |
 * | denylist | `--exclude-tools a,b,c` (comma-joined) | `--disallowedTools a b c` (variadic) |
 * | no tools at all | `--no-tools` | no equivalent |
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
 * - `--tools` is a hard allowlist across all three tool categories on pi (built-in, extension, and
 *   custom), not an addition to the built-in set. Measured: `--tools read` alone yields exactly
 *   `["read"]`, with the probe extension's own tool gone. No base flag is needed to make an
 *   allowlist restrict. `--no-tools` is emitted with it anyway, because it costs nothing, states
 *   the intent in the argv, and keeps the allowlist a ceiling if a future pi made `--tools`
 *   additive.
 * - `--no-tools` is the empty-session flag, NOT `--no-builtin-tools`. `--no-builtin-tools` keeps
 *   extension and custom tools by design: measured alone it yields `["probe_marker_tool"]`, the
 *   extension tool, while `--no-tools` yields `[]`. An allowlist that `deny` empties must therefore
 *   project to `--no-tools`, or the "zero tools" request would still expose every tool the selected
 *   extensions register.
 * - `deny` is ALWAYS emitted on both harnesses, including when `allow` is also set and has already
 *   removed those names. On Claude this is load-bearing: absence from `--allowedTools` only means
 *   "using it needs approval", so the exclusion would otherwise rest on the unverified prompt path.
 *   On pi it is belt and braces, since a tool left out of `--tools` does not exist. Either way it
 *   satisfies OFTR-003.10.4 ("denied tools MUST win when projected") without depending on the
 *   filter alone.
 * - Claude's flags are variadic. They consume every following token until the next `--flag`, so
 *   these args must stay ahead of a flag-bearing group in the launch plan and must never sit
 *   immediately before pass-through positionals, which would be eaten as tool names. Emitting
 *   `--allowedTools` before `--disallowedTools` terminates the first; the launch plan places the
 *   whole group ahead of the prompt flags, which terminates the second. pi's flags take one
 *   comma-joined value each, so they are not exposed to this.
 */
export const toolArgs = (harness: Harness, tools: ToolSelection): readonly string[] => {
  // Before filtering, so a poisoned name is rejected even when `deny` would have removed it, and on
  // both harnesses: `projectComposition` is exported and reachable without schema validation, so
  // this cannot assume the read boundary already ran.
  assertProjectableToolNames(tools);
  const allow = effectiveToolAllowlist(tools);
  const deny = tools.deny ?? [];

  if (harness === 'pi') {
    return [
      // No allowlist declared means no ceiling requested; `deny` below still applies.
      ...(allow === undefined ? [] : allow.length === 0 ? ['--no-tools'] : ['--no-tools', '--tools', allow.join(',')]),
      ...(deny.length === 0 ? [] : ['--exclude-tools', deny.join(',')]),
    ];
  }

  return [
    // An allowlist emptied by `deny` drops `--allowedTools` entirely, because Claude has no
    // "deny everything" form: an empty list is not accepted as one and there is no counterpart to
    // pi's `--no-tools`. All that survives is the explicit `--disallowedTools` below. A
    // fully-emptied allowlist on Claude is therefore NOT equivalent to pi's zero-tool session; it
    // denies exactly the named tools and leaves the rest of the builtin set present.
    ...(allow === undefined || allow.length === 0 ? [] : ['--allowedTools', ...allow]),
    ...(deny.length === 0 ? [] : ['--disallowedTools', ...deny]),
  ];
};
