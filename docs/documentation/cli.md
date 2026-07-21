# CLI reference

> **Status: RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165) target.** This reference describes the dotagents end-state command surface. The currently released CLI still implements the legacy profile commands; implementation PRs replace them incrementally.

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
outfitter run reviewer -- --print "summarize this repo"
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

Synchronize remote sources and remote settings into the local cache. Reports a per-source status of `updated`, `unchanged`, `skipped`, or `failed`, and validates synced sources.

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
