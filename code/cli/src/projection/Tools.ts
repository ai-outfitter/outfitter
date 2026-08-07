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
 * pi and Claude Code BOTH have an availability control; Claude additionally has a permission layer
 * on top of its own. The pi rows were measured against pi 0.83.0 with a probe extension that
 * registers a uniquely-named tool and prints `pi.getActiveTools()` at `session_start`; the exact
 * runs are recorded in the PR for #255. The Claude rows come from `claude --help` and
 * https://code.claude.com/docs/en/cli-reference — documented behaviour, not locally measured.
 *
 * | | pi | claude |
 * | availability ceiling | `--no-tools --tools a,b,c` (comma-joined) | `--tools a b c` (variadic; built-in set only) |
 * | pre-approval within it | n/a — pi has no permission layer | `--allowedTools a b c` (variadic) |
 * | denylist | `--exclude-tools a,b,c` (comma-joined) | `--disallowedTools a b c` (variadic; a bare name removes the tool from context, per docs) |
 * | no tools at all | `--no-tools` | `--tools ""` (empties the built-in set only) |
 *
 * An allowlist therefore projects to TWO flags on Claude: `--tools` is the ceiling (the tool is not
 * in the session), and `--allowedTools` pre-approves the same names within that ceiling so a
 * headless session is not stopped by a permission prompt for the very tools the profile granted.
 * Either flag alone would be wrong: `--allowedTools` alone leaves every unlisted builtin available
 * (merely unapproved), and `--tools` alone leaves the granted tools prompting for approval.
 *
 * Scope caveat, from the CLI reference: `--tools` governs the BUILT-IN set only. MCP tools
 * (`mcp__server__*`) are untouched by it — they are governed by which servers load (the `mcp`
 * loadout element) and by `--disallowedTools` patterns such as `mcp__*`. So `--tools ""` is not
 * pi's zero-tool session when MCP servers are selected: the builtins are gone, the MCP tools
 * remain. (`mcp__*` does pass TOOL_NAME_PATTERN, but only Claude reads `*` as a wildcard; on pi it
 * would be a literal name, so a harness-neutral profile cannot lean on it.)
 *
 * Four rules follow from the flags themselves:
 *
 * - On pi, `--tools` is a hard allowlist across all three tool categories (built-in, extension, and
 *   custom), not an addition to the built-in set. Measured: `--tools read` alone yields exactly
 *   `["read"]`, with the probe extension's own tool gone. No base flag is needed to make an
 *   allowlist restrict. `--no-tools` is emitted with it anyway, because it costs nothing, states
 *   the intent in the argv, and keeps the allowlist a ceiling if a future pi made `--tools`
 *   additive.
 * - `--no-tools` is pi's empty-session flag, NOT `--no-builtin-tools`. `--no-builtin-tools` keeps
 *   extension and custom tools by design: measured alone it yields `["probe_marker_tool"]`, the
 *   extension tool, while `--no-tools` yields `[]`. An allowlist that `deny` empties must therefore
 *   project to `--no-tools` on pi and `--tools ""` on Claude (help: 'Use "" to disable all tools'),
 *   or the "zero tools" request would fail open and leave the whole builtin set available. The
 *   empty value is one empty-string argv element — no shell is involved, so it survives as such.
 * - `deny` is ALWAYS emitted on both harnesses, including when `allow` is also set and has already
 *   removed those names. On Claude a bare name in `--disallowedTools` removes the tool from context
 *   per the docs, which makes the explicit denial an availability statement in its own right rather
 *   than a bet on the approval path. On pi it is belt and braces, since a tool left out of
 *   `--tools` does not exist. Either way it satisfies OFTR-003.10.4 ("denied tools MUST win when
 *   projected") without depending on the filter alone.
 * - Claude's three flags are all variadic. Each consumes every following token until the next
 *   `--flag`, so they are emitted in a fixed order — `--tools`, `--allowedTools`,
 *   `--disallowedTools` — where each present flag is terminated by the next one, and the launch
 *   plan places the whole group first, ahead of the prompt flags, which terminate the last. They
 *   must never sit immediately before pass-through positionals, which would be eaten as tool names.
 *   pi's flags take one comma-joined value each, so they are not exposed to this.
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
    // The ceiling and the pre-approval within it. An allowlist emptied by `deny` projects to
    // `--tools ""` — one empty-string argv element, Claude's documented "disable all tools" form —
    // with no `--allowedTools`, because there is nothing left to pre-approve. Only the builtin set
    // is emptied: MCP tools from selected servers survive `--tools ""` (see the scope caveat
    // above), so this is close to, but not exactly, pi's zero-tool session.
    ...(allow === undefined
      ? []
      : allow.length === 0
        ? ['--tools', '']
        : ['--tools', ...allow, '--allowedTools', ...allow]),
    ...(deny.length === 0 ? [] : ['--disallowedTools', ...deny]),
  ];
};
