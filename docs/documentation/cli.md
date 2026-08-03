# CLI reference

Global options:

| Option          | Description                  |
| --------------- | ---------------------------- |
| `-V, --version` | Print the Outfitter version. |
| `-h, --help`    | Show help for a command.     |

## `outfitter run [agent] [args...]`

Resolve, compose, and launch an agent. `run` is the default command, so plain `outfitter` and `outfitter run` are equivalent.

| Argument / Option     | Description                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| `[agent]`             | Agent slug to run. Defaults to the settings `default_agent`.                     |
| `--harness <harness>` | Harness to launch in: `pi` or `claude`. Defaults to `default_harness`.           |
| `--strict`            | Fail instead of warning when the adapter cannot project part of the composition. |

Any other arguments and unrecognized options are passed through to the launched harness:

```bash
outfitter run engineer --harness claude
outfitter run persona-reviewer -- --print "summarize this repo"
```

Because `run` is the default command, leading flags that Outfitter does not own are forwarded to the harness automatically. With a configured `default_agent`, the following forms pass flags directly to Pi:

```bash
outfitter -r            # equivalent to: outfitter run -- -r
outfitter --resume      # equivalent to: outfitter run -- --resume
```

## `outfitter setup [source]`

Open the bundled Pi walkthrough using the original setup wording and sequence. Choose **Use the
default Outfitter profile catalog**, **Create your own profile**, or **Provide a different catalog
to import**; complete that branch; choose a home/project settings target; then choose the default
CLI agent. Pi/Outfitter is preselected. Passing `[source]` retains the original direct-source path
and starts at target selection. Pi hosts the deterministic setup UI without a model provider and
does not port or symlink harness configuration. The default picker always comes from
`ai-outfitter/default-profiles` at the immutable Release Please version tag pinned by the installed
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

| Argument | Description                                                   |
| -------- | ------------------------------------------------------------- |
| `[kind]` | Optional filter: `agents`, `skills`, `knowledge`, `commands`. |

## `outfitter validate`

Validate the effective resource set: protocol layout, frontmatter, unresolved slugs in agent loadouts, broken or escaping skill references, and settings schema.

| Option     | Description                              |
| ---------- | ---------------------------------------- |
| `--strict` | Exit non-zero when warnings are present. |
| `--json`   | Print diagnostics as JSON.               |

## `outfitter dump`

Write the composed resource tree as a self-contained `.agents/` directory for review, vendoring, or air-gapped use. Identical sources, refs, and selections produce byte-identical output; dumps never contain credentials, sessions, caches, or other mutable runtime state.

| Option         | Description                                          |
| -------------- | ---------------------------------------------------- |
| `--agent <id>` | Restrict the dump to one agent's transitive closure. |
| `--out <dir>`  | Destination directory (default `./.agents`).         |

> **Tasks and `outfitter task bake`** — baking a task and its inputs into an immutable execution artifact — are the subject of a separate upcoming RFC and are not part of this command surface yet. See [Tasks](./tasks.md).
