# CLI reference

Global options:

| Option          | Description                  |
| --------------- | ---------------------------- |
| `-V, --version` | Print the Outfitter version. |
| `-h, --help`    | Show help for a command.     |

## `outfitter run [args...]`

Assemble a profile composite profile and launch the selected agent CLI. `run` is the default command, so plain `outfitter` and `outfitter run` are equivalent.

| Option                    | Description                                                                |
| ------------------------- | -------------------------------------------------------------------------- |
| `-p, --profile <profile>` | Outfitter profile id to run. Defaults to the settings `default_profile`.   |
| `--agent <agent>`         | Agent adapter to launch: `pi` or `claude`. Defaults to `default_agent`.    |
| `--strict`                | Fail instead of warning when controls cannot be translated by the adapter. |

Any other arguments and unrecognized options are passed through to the launched agent CLI:

```bash
outfitter run --profile engineer --agent claude
outfitter -p data_analyst -- --print "summarize this repo"
```

On a first interactive launch with no `~/.outfitter/settings.yml`, `outfitter` starts Pi-native onboarding instead of a normal run.

## `outfitter setup [source]`

Create initial Outfitter settings and a default profile. Setup launches Pi with the Outfitter onboarding extension and finishes profile selection inside the agent session (see [Getting started](./getting-started.md)).

| Argument   | Description                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| `[source]` | Optional setup source: a local path or a git URL of a [profile repository](./profile-repository.md) to import. |

## `outfitter sync`

Synchronize URI-backed profile and remote settings sources into the local cache (`~/.outfitter/cache/`). Takes no options. Reports a per-source status of `updated`, `unchanged`, `skipped`, or `failed`, and validates synced profile sources.

## `outfitter profile`

List and manage Outfitter profiles.

### `outfitter profile list`

List available Outfitter profiles.

| Option  | Description                                                       |
| ------- | ----------------------------------------------------------------- |
| `--all` | Include template profiles that are intended only for inheritance. |

### `outfitter profile create <name>`

Create a new Outfitter profile skeleton.

| Argument / option | Description                                               |
| ----------------- | --------------------------------------------------------- |
| `<name>`          | Filesystem-safe profile name.                             |
| `--scope <scope>` | Destination scope: `user`, `project`, or `project-local`. |
| `--path <path>`   | Destination profile source directory.                     |

### `outfitter profile lint`

Validate profiles, inheritance, and typed prompt includes.

| Option     | Description                              |
| ---------- | ---------------------------------------- |
| `--strict` | Exit non-zero when warnings are present. |
| `--json`   | Print diagnostics as JSON.               |

## `outfitter welcome`

Run Outfitter welcome onboarding prompts in the terminal. This is a legacy compatibility command: current onboarding runs natively inside Pi (via `outfitter setup` or the first-run `outfitter` launch), and `welcome` remains for environments that need the older terminal prompt flow. Requires an interactive TTY. Takes no options.
