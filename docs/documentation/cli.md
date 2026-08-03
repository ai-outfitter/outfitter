# CLI reference

Global options:

| Option          | Description                  |
| --------------- | ---------------------------- |
| `-V, --version` | Print the Outfitter version. |
| `-h, --help`    | Show help for a command.     |

## `outfitter run [agent] [args...]`

Resolve, compose, and launch an agent. `run` is the default command, so plain `outfitter` and `outfitter run` are equivalent.

| Argument / Option        | Description                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `[agent]`                | Agent slug to run. Defaults to the settings `default_agent`.                                    |
| `--harness <harness>`    | Harness to launch in: `pi` or `claude`. Defaults to `default_harness`.                          |
| `--runtime-layer <path>` | Add an invocation-only `.agents` payload root. Repeatable; earlier occurrences take precedence. |
| `--strict`               | Fail instead of warning when the adapter cannot project part of the composition.                |

Any other arguments and unrecognized options are passed through to the launched harness:

```bash
outfitter run engineer --harness claude
outfitter run persona-reviewer -- --print "summarize this repo"
```

`run` launches the harness in the foreground with inherited standard input, output, and error
streams. If Outfitter receives `SIGINT` or `SIGTERM`, it forwards the first signal to the harness
process group and waits for it to terminate before persisting native credential state or removing
the temporary projection. A harness terminated by `SIGINT` exits as 130; `SIGTERM` exits as 143.

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

| Argument / Option        | Description                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `[kind]`                 | Optional filter: `agents`, `skills`, `knowledge`, `commands`.                                   |
| `--runtime-layer <path>` | Add an invocation-only `.agents` payload root. Repeatable; earlier occurrences take precedence. |

## `outfitter validate`

Validate the effective resource set: protocol layout, frontmatter, unresolved slugs in agent loadouts, broken or escaping skill references, and settings schema.

| Option                   | Description                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `--runtime-layer <path>` | Add an invocation-only `.agents` payload root. Repeatable; earlier occurrences take precedence. |
| `--strict`               | Exit non-zero when warnings are present.                                                        |
| `--json`                 | Print diagnostics as JSON.                                                                      |

## `outfitter dump`

Write the composed resource tree as a self-contained `.agents/` directory for review, vendoring, or air-gapped use. Identical sources, refs, and selections produce byte-identical output; dumps never contain credentials, sessions, caches, or other mutable runtime state.

| Option                   | Description                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `--agent <id>`           | Restrict the dump to one agent's transitive closure.                                            |
| `--runtime-layer <path>` | Add an invocation-only `.agents` payload root. Repeatable; earlier occurrences take precedence. |
| `--out <dir>`            | Destination directory (default `./.agents`).                                                    |

> **Tasks and `outfitter task bake`** — baking a task and its inputs into an immutable execution artifact — are the subject of a separate upcoming RFC and are not part of this command surface yet. See [Tasks](./tasks.md).

## Invocation-only runtime layers

`--runtime-layer <path>` points directly at a protocol-shaped payload root—the directory containing
`agents/`, `skills/`, `knowledge/`, and other `.agents` entries, not a parent directory containing
another `.agents/` folder. Relative paths resolve from the active project directory.

Runtime layers are useful when a supervisor generates workflow resources for one invocation without
editing the checked-out project or writing harness-native Pi or Claude files:

```bash
outfitter run engineer \
  --harness pi \
  --runtime-layer /run/task/workflow.agents \
  --strict -- --print "Continue the assigned task"
```

Runtime layers have higher precedence than the project workspace, user tree, and configured sources.
When the option is repeated, the first occurrence has the highest precedence. They participate in
the same resolver used by `list`, `validate`, `run`, and `dump`, are never persisted into settings,
and do not change source trees.

The invocation is transport-neutral: a local Docker/tmux supervisor, GitHub Actions job, or
Kubernetes Job supplies the workspace as the current directory, materializes any runtime layer, and
starts the same foreground command. Placement, liveness, cancellation grace periods, retries,
credentials injection, and workspace cleanup remain the supervisor's responsibility.
