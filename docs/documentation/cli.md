# CLI reference

> **Status: RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165) target.** This reference describes the dotagents end-state command surface. The currently released CLI still implements the legacy profile commands; implementation PRs replace them incrementally.

Global options:

| Option          | Description                  |
| --------------- | ---------------------------- |
| `-V, --version` | Print the Outfitter version. |
| `-h, --help`    | Show help for a command.     |

## `outfitter run [args...]`

Resolve, compose, bake, and launch. `run` is the default command, so plain `outfitter` and `outfitter run` are equivalent.

| Option                    | Description                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| `-p, --profile <profile>` | Named profile selection to run. Defaults to the settings `default_profile`.      |
| `--task <task>`           | Task slug to bake and run instead of a profile.                                  |
| `--agent <agent>`         | Agent adapter to launch: `pi` or `claude`. Defaults to `default_agent`.          |
| `--strict`                | Fail instead of warning when the adapter cannot project part of the composition. |

Any other arguments and unrecognized options are passed through to the launched agent CLI:

```bash
outfitter run --profile engineer --agent claude
outfitter run --task issue-triage
outfitter -p reviewer -- --print "summarize this repo"
```

`--task` always goes through the [bake path](./dump-and-bake.md): the task and its dependencies are resolved into an immutable artifact before launch.

## `outfitter setup [source]`

Create initial Outfitter settings, or adopt an existing configuration. Setup detects an existing `~/.agents/` tree and uses it as-is; if it finds a `~/.claude` directory instead, it offers to [port and symlink it](./porting-claude.md).

| Argument   | Description                                                                       |
| ---------- | --------------------------------------------------------------------------------- |
| `[source]` | Optional bootstrap source: a local path or git URL of a [catalog](./catalogs.md). |

## `outfitter sync`

Synchronize remote sources and remote settings into the local cache. Reports a per-source status of `updated`, `unchanged`, `skipped`, or `failed`, and validates synced sources.

## `outfitter list [kind]`

List resolvable resources across all layers, with the winning source for each slug and any shadowed IDs.

| Argument | Description                                                                        |
| -------- | ---------------------------------------------------------------------------------- |
| `[kind]` | Optional filter: `agents`, `skills`, `tasks`, `profiles`, `knowledge`, `commands`. |

## `outfitter validate`

Validate the effective resource set: protocol layout, frontmatter, unresolved slugs in profile and task selections, broken or escaping skill references, and settings schema.

| Option     | Description                              |
| ---------- | ---------------------------------------- |
| `--strict` | Exit non-zero when warnings are present. |
| `--json`   | Print diagnostics as JSON.               |

## `outfitter task bake <task>`

Resolve a task and its dependencies — personas, skills, models, MCP, knowledge, inputs — into an immutable execution artifact backed by a self-contained `.agents/` tree. See [Dump and bake](./dump-and-bake.md).

| Option          | Description                                   |
| --------------- | --------------------------------------------- |
| `--input <k=v>` | Provide a structured task input (repeatable). |
| `--out <dir>`   | Write the baked artifact to a directory.      |

## `outfitter dump`

Write the composed resource tree as a self-contained `.agents/` directory for review, vendoring, or air-gapped use. Identical sources, refs, selections, and inputs produce byte-identical output; dumps never contain credentials, sessions, caches, or other mutable runtime state.

| Option                           | Description                                              |
| -------------------------------- | -------------------------------------------------------- |
| `--profile <id>` / `--task <id>` | Restrict the dump to one selection's transitive closure. |
| `--out <dir>`                    | Destination directory (default `./.agents`).             |
