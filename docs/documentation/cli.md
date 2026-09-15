# CLI reference

Global options:

| Option          | Description                  |
| --------------- | ---------------------------- |
| `-V, --version` | Print the Outfitter version. |
| `-h, --help`    | Show help for a command.     |

See [Telemetry](./telemetry.md) for the pseudonymous analytics event contract and opt-out controls.

## `outfitter run [agent] [args...]`

Resolve, compose, and launch an agent. `run` is the default command, so plain `outfitter` and `outfitter run` are equivalent.

| Argument / Option     | Description                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[agent]`             | Agent slug to run. Defaults to the settings `default_agent`.                                                                                                      |
| `--harness <harness>` | Harness to launch in: `pi`, `claude`, or `codex`. Defaults to `default_harness`.                                                                                  |
| `--log-level <level>` | Use `info` for quiet loading or `debug` for installer output.                                                                                                     |
| `--strict`            | Fail instead of warning when the adapter cannot project part of the composition.                                                                                  |
| `--isolated`          | Launch from the composition alone, ignoring your own harness configuration (trust, permissions, MCP servers, plugins). Claude only; the default is to inherit it. |
| `--retain-projection` | Keep the runtime projection directory after the run and print its path, for inspection.                                                                           |

Set `OUTFITTER_LOG_LEVEL=debug` to enable debug startup output without passing the option. The
`setup` command also accepts `--log-level` for its automatic profile launch.

Set `OUTFITTER_PI_BIN=/path/to/pi` to launch that binary instead of the bundled pi for one run; it
overrides the `pi_binary` / `pi_binary_path` settings keys (see
[Settings — Pi binary selection](./settings.md#pi-binary-selection)).

Any other arguments and unrecognized options are passed through to the launched harness:

```bash
outfitter run engineer --harness claude
outfitter run engineer --harness codex -- exec "review this repo"
outfitter run persona-reviewer -- --print "summarize this repo"
```

Because `run` is the default command, leading flags that Outfitter does not own are forwarded to the harness automatically. With a configured `default_agent`, the following forms pass flags directly to Pi:

```bash
outfitter -r            # equivalent to: outfitter run -- -r
outfitter --resume      # equivalent to: outfitter run -- --resume
```

## `outfitter exec <agent> <subcommand> [args...]`

Run a harness CLI subcommand (such as `pi list` or `pi install npm:some-package`) inside the composed profile for an agent. `exec` resolves, composes, and projects the agent exactly like `run`, then launches the harness with the subcommand as the first argument, so the harness runs its own command instead of treating it as a chat prompt. The projection directory is deleted when the subcommand exits unless `--retain-projection` is given; installs made inside the projection are discarded with it, so durable extension selection stays in the profile loadout.

| Argument / Option     | Description                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `<agent>`             | Agent slug whose composed profile provides the environment.                              |
| `<subcommand>`        | Harness CLI subcommand to run; it becomes the first argument of the harness process.     |
| `[args...]`           | Arguments passed to the subcommand verbatim, including the harness's own flags.          |
| `--harness <harness>` | Harness to launch in: `pi`, `claude`, or `codex`. Defaults to `default_harness`.         |
| `--log-level <level>` | Use `info` for quiet loading or `debug` for installer output.                            |
| `--strict`            | Fail instead of warning when the adapter cannot project part of the composition.         |
| `--isolated`          | Launch from the composition alone, ignoring your own harness configuration. Claude only. |
| `--retain-projection` | Keep the runtime projection directory after the subcommand exits, for inspection.        |

The launch carries the projected environment (`PI_CODING_AGENT_DIR` points at the composed projection for pi), but none of the interactive session flags: no system prompt, skills, extensions, model, thinking, or tool selection is placed on the argv, because harness subcommands parse their own flags and must sit at the front. `exec` never starts first-run setup.

```bash
outfitter exec engineer list
outfitter exec engineer install -- -l npm:@example/extension
outfitter exec engineer --harness claude mcp
```

## `outfitter setup [source]`

Open the bundled Pi walkthrough. Choose a featured profile from the default catalog (Engineer,
Founder, or Software Factory; Engineer is preselected), open **More profiles** for the rest, or
**Import a different .agents catalog**; complete that branch; choose a home/project
settings target; then choose the default CLI agent. Pi/Outfitter is preselected. To use a custom
profile instead, write `.agents/agents/<id>/agent.md` and set `default_agent`. Passing `[source]` retains the original direct-source path
and starts at target selection. Pi hosts the deterministic setup UI without a model provider and
does not port or symlink harness configuration. The default picker always comes from
`ai-outfitter/community-profiles` at the immutable Release Please version tag pinned by the installed
Outfitter version; setup fetches or reuses that release through the normal source cache and writes
the same GitHub/ref pair to settings. It never reads a sibling checkout or a packaged catalog
fallback.

## `outfitter sync`

Synchronize remote sources and remote settings into the local cache. Sync validates local settings,
updates `remote_settings`, reloads the merged settings, and then updates the remote `sources` that
result. Each repository reports `updated`, `unchanged`, `skipped`, or `failed`.

Fetched content is validated in a temporary checkout before an atomic cache swap, so a failed fetch
or invalid update leaves the last valid cache available. Required-source failures and invalid
settings exit nonzero. Credentials embedded in URIs are redacted from status, errors, cache paths,
and Git output.

Sync is explicit: `outfitter run` never initiates network access. If a configured cache is absent,
resolution tells you to run `outfitter sync`.

## `outfitter list [kind]`

List resolvable resources across all layers, with the winning source for each slug and any shadowed IDs.

| Argument | Description                                                                              |
| -------- | ---------------------------------------------------------------------------------------- |
| `[kind]` | Optional filter: `agents`, `skills`, `knowledge`, `commands`, `workflows`, `extensions`. |

`--json` emits an object containing `ok`, `resources`, and `diagnostics`; diagnostics remain available under strict mode. Each workflow resource entry also contains a name-sorted `outputs` object with resolved output labels, or `{}` when the workflow declares none. Non-JSON output is unchanged. See [OFTR-013: Workflow Contract](../requirements/OFTR-013-workflow-contract.md).

The `extensions` kind is different from the resource kinds: it reports the machine-local pi
extension cache (`~/.cache/outfitter/pi-extensions/`) instead of composed resources, so it needs
no settings, project, or agent — and it rejects `--agent`. Each cached `npm:` extension is
reported with its reconstructed specifier (including the range recorded in the cache manifest),
its resolved installed version, and its upstream status; each cached `git:` checkout is reported
with its specifier (including the branch/tag pin recovered from the install marker), its checkout
HEAD, and its upstream status. Local-path extensions are not listed — they never enter the cache.

Upstream status is one of `up-to-date`, `update-available (<latest>)` (npm: the registry's
`latest` dist-tag newer than the resolved version; git: the remote tip of the pinned ref — or of
the default branch for unpinned checkouts — ahead of the checkout HEAD), `pinned (at <sha>)`
(full-SHA git pins are frozen and never checked), or `unknown (<detail>)`. Upstream lookups are
read-only (`npm view`, `git ls-remote`) and run by default; pass `--offline` (or set `PI_OFFLINE`)
to skip them, reporting `unknown (offline)` deterministically. A failed lookup degrades that
entry to `unknown (lookup failed)` with a warning; `--strict` makes warnings fatal.
`--json` for extensions emits `ok`, `extensions` (the full report entries), and `diagnostics`.
See [OFTR-006: Agent Adapters](../requirements/OFTR-006-agent-adapters.md) item 34. This listing never mutates the cache; updating it is `outfitter update extensions` below.

## `outfitter update extensions`

Update the cached pi extensions in place: reinstalls outdated npm packages at the registry's
current release and fast-forwards git checkouts whose pinned branch moved remotely. The command
is an explicit mutation — `outfitter run` never initiates it, and nothing else in Outfitter
mutates the extension cache. Like the `extensions` listing, it needs no settings, project, or
agent, and it never touches loadout files or settings.

| Option      | Description                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------ |
| `--offline` | Skip every upstream lookup, mutate nothing, and report each entry `offline` (also `PI_OFFLINE`). |
| `--dry-run` | Perform only the read-only lookups and report what would update as `would-update (to <target>)`. |
| `--strict`  | Treat warnings (for example a failed peer install) as fatal.                                     |
| `--json`    | Emit a stable object with `ok`, `dryRun`, `updates`, and `diagnostics`.                          |

Each cached entry is decided and mutated independently (entry-scoped transactions): a failed
registry lookup, failed install, or failed fetch leaves that entry's cache state untouched,
reports it as `failed (<reason>)`, and never blocks other entries. npm: a dependency entry whose
recorded version is exact is a deliberate pin and is skipped; any other entry is reinstalled at
the registry's `latest` release when strictly newer than the resolved version, as an exact
version through the same install path the cache itself uses, followed by peer-dependency
satisfaction. git: full-SHA pins and pinned tags are never moved; branch-pinned and unpinned
checkouts compare against the remote tip of their ref (or the default branch when unpinned) and
fast-forward with fetch plus `git merge --ff-only` — a diverged checkout fails as
`not fast-forwardable` instead of being reset, and the install marker's recorded HEAD is
refreshed. The command performs network work by default because updating is its purpose.

The summary lists one line per entry in the listing's deterministic order (npm entries by package
name, then git entries by checkout path):

```text
extensions update:
  npm:hashline-pi@^0.1.0  0.1.0 -> 0.1.1  updated
  npm:pin-pkg@1.2.3       1.2.3  skipped (pinned)
  git:github.com/user/repo@main  abc1234 -> def5678  updated
  git:github.com/user/frozen     abc1234  skipped (pinned)
```

Updating moves the shared cache: a package some agent's loadout exact-pins can be transiently
displaced, and that agent's next run reinstalls its pin (online; offline it warns, fatal under
`--strict`), the same stale-pin behavior any reinstall already produces. Any failed entry exits
non-zero.

See [OFTR-006: Agent Adapters](../requirements/OFTR-006-agent-adapters.md) item 35.

## `outfitter validate`

Validate the effective resource set: protocol layout, frontmatter, unresolved slugs in agent loadouts, broken or escaping skill references, workflow graphs and composed closures, and settings schema.

| Option     | Description                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `--strict` | Exit non-zero on incomplete or unsupported composition warnings; deterministic shadowing remains advisory. |
| `--json`   | Print diagnostics as JSON.                                                                                 |

## `outfitter dump`

Write the composed resource tree as a self-contained `.agents/` directory for review, vendoring, or air-gapped use. Identical sources, refs, and selections produce byte-identical output; dumps never contain credentials, sessions, caches, or other mutable runtime state.

| Option            | Description                                                                    |
| ----------------- | ------------------------------------------------------------------------------ |
| `--agent <id>`    | Restrict the dump to one agent's transitive closure.                           |
| `--workflow <id>` | Export one workflow, its nested workflows, and every referenced agent closure. |
| `--out <dir>`     | Destination directory (default `./.agents`).                                   |

Workflow dumps are non-executable configuration bundles. They contain the canonical workflow YAML, composed agent resources, and a hash/provenance manifest whose `workflows[]` entries record resolved `outputs`. A workflow dump refuses an existing destination instead of replacing user files.

> **Tasks and `outfitter task bake`** — baking a task and its inputs into an immutable execution artifact — are the subject of a separate upcoming RFC and are not part of this command surface yet. See [Tasks](./tasks.md).

`outfitter run` verifies these caches before composition. Use
`--source-cache-policy <repair|locked|offline>` to override the configured startup policy.

## `outfitter link`

Project composed resources and native defaults into Pi, Claude Code, and Codex homes, so plain
`pi`, `claude`, and `codex` sessions carry shared configuration
without going through `outfitter run`. `run` still uses a temporary projection; `link` is the
opt-in persistent one. See [Linking into Claude Code and Codex](./linking-harnesses.md).

| Option             | Description                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `--harness <name>` | Harness home to link into: `pi`, `claude`, or `codex` (repeatable). Defaults to every harness on `PATH` or with an existing home. |
| `--agent <id>`     | Agent whose composed closure to link (repeatable).                                                                                |
| `--workflow <id>`  | Enabled workflow whose agent closures to link (repeatable).                                                                       |
| `--all`            | Link every resolvable agent, with its skills and commands.                                                                        |
| `--dry-run`        | Report what would change (`would create`, `would update`, `would prune`) without touching the home.                               |
| `--remove`         | Remove every entry this command created and forget it.                                                                            |
| `--strict`         | Exit non-zero on non-advisory warnings, conflicts, or skipped entries; deterministic shadowing remains advisory.                  |

```bash
outfitter link                                    # enabled workflows + default_agent, every installed harness
outfitter link --workflow engineer --harness claude
outfitter link --all --dry-run
outfitter link --remove
```

With no selection the scope is every enabled workflow root (`workflows:` in settings) plus
`default_agent`. Each scoped agent is composed the same way `run` and `dump` compose it, and its
subagents join the closure. The harness home is `$CLAUDE_CONFIG_DIR` (default `~/.claude`) or
`$CODEX_HOME` (default `~/.codex`); an explicit `--harness` creates the home if it is missing.

Ownership is recorded in `<harness home>/.outfitter/links.json`. `link` never overwrites, adopts, or
deletes anything it did not create: an unmanaged file, directory, or symlink in the way is reported
as a `conflict` and left alone. Re-running is idempotent (`unchanged`), a managed link whose target
vanished is `pruned`, and MCP servers already registered in the harness are left as they are.

## `outfitter sources`

Report local and remote source precedence, requested and resolved revisions, origins, and cache
health. `outfitter sources --json` emits stable credential-redacted machine-readable output.
