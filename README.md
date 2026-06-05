# applepi

`applepi` is intended to be a management wrapper for launching [`pi`](https://github.com/earendil-works/pi-coding-agent) and Claude Code with configurable, reusable profiles.

The goal is manageable agent CLI configuration: organizations should be able to define standard pi or Claude Code loadouts, distribute them to their workforce, and launch agent CLIs consistently across teams, roles, projects, or environments.

## Why this exists

Pi is highly configurable through settings directories, extensions, skills, prompts, themes, model settings, environment variables, and CLI flags.
That flexibility is powerful, but businesses often need a higher-level control plane for repeatable deployments.

`applepi` should make it easy to answer questions like:

- Which pi configuration should this employee or team use?
- Which extensions, skills, prompts, models, and providers are approved?
- Which credentials or environment variables should be present?
- Should project-local `.pi` configuration be allowed, merged, or ignored?
- How do we ship multiple standardized pi loadouts without manual setup?

## Intended use case

Example profile concepts:

- `engineering-default` — standard engineering loadout with approved tools, prompts, and models.
- `support` — customer-support-focused prompt and restricted tool set.
- `sandbox` — isolated experimentation profile with disposable config and sessions.
- `regulated` — locked-down profile with stricter extensions, context, and session behavior.

A launch flow is intended to look like:

```bash
applepi
applepi run --profile engineering-default
applepi run -p support -- --cwd ~/work/customer-issue
applepi sync
applepi setup
applepi setup https://github.com/my_account/applepi_config
applepi profile list
applepi profile create regulated --scope user
```

Under the hood, `applepi` translates a selected profile into the selected agent launch environment.
Pi runs use `PI_CODING_AGENT_DIR`; Claude Code runs use `CLAUDE_CONFIG_DIR`; both receive supported CLI flags, prompts, model settings, and environment variables.
Select the adapter with `applepi run --agent <pi|claude>`, or set `default_agent` in `settings.yml`.
If neither is set, ApplePi defaults to pi for backward compatibility.
If `applepi` is run before `applepi setup`, it creates the initial settings and default profile automatically before launching.

`settings.yml` can point at local profiles, full Git URIs, or GitHub shorthand sources with optional refs and repository subpaths:

```yaml
remote_settings:
  - github: my_account/applepi_config
    ref: main
    path: settings.yml

profile_sources:
  - github: my_account/applepi_config
    ref: main
    path: profiles
```

Run `applepi sync` to fetch/update remote settings and profiles before using them.

By default, ApplePi keeps reusable runtime cache files under `~/.applepi/cache`.
Set `cache_directory` in `settings.yml` to choose a different cache root; relative values resolve from the settings file that declares them.
The pi adapter symlinks composite profile `utilities/` and `bin/` paths into this cache so pi-managed utilities such as `fd` and `rg` survive across temporary composite profile directories.

Settings can also define arbitrary nested `custom_settings` values for ApplePi-time composite profile templating:

```yaml
custom_settings:
  build_commands:
    lint: npm run lint
```

Generated composite profile files can reference them with ApplePi's LiquidJS-based custom delimiters:

```yaml
command: '[[= applepi.custom_settings.build_commands.lint ]]'
```

Control tags use `[[% ... %]]`, for example `[[% for item in applepi.custom_settings.items %]]`.
ApplePi intentionally does not use common `{{ ... }}` delimiters, and plain shell expressions like `[[ -f package.json ]]` are left alone.

## Setup from a settings repository

You can bootstrap a machine from a Git repository:

```bash
applepi setup https://github.com/my_account/applepi_config
```

`applepi setup` requires an interactive terminal on both stdin and stdout.
When a repository is provided, it clones or updates the repository in ApplePi's shared repository cache, then uses it as a non-overwriting starting point:

- if `~/.applepi/settings.yml` does not exist, ApplePi copies the starter `settings.yml`;
- if starter profiles exist, ApplePi copies missing profile files into `~/.applepi/profiles/`;
- existing user settings and profile files are otherwise left unchanged;
- after setup, ApplePi runs the same sync behavior used by `applepi sync`;
- ApplePi then shows a short setup wizard that lists synced profiles and writes the selected default profile to user settings.

A setup repository can use either root-level ApplePi files:

```text
applepi_config/
  settings.yml
  profiles/
    engineering-default/
      profile.yml
    support/
      profile.yml
```

or a `.applepi/` layout:

```text
applepi_config/
  .applepi/
    settings.yml
    profiles/
      engineering-default/
        profile.yml
      support/
        profile.yml
```

Example `settings.yml` for a setup repository:

```yaml
default_profile: engineering-default

profile_sources:
  - path: ./profiles

  # Optional: keep loading future updates from this same repo.
  - github: my_account/applepi_config
    ref: main
    path: profiles
```

If you want ongoing centralized settings, use a small local `~/.applepi/settings.yml` that points at remote settings:

```yaml
remote_settings:
  - github: my_account/applepi_config
    ref: main
    path: settings.yml
```

Then run:

```bash
applepi sync
```

## Profile model sketch

A profile will use YAML.
An initial profile shape is:

```yaml
id: engineering-default
label: Engineering Default
inherits:
  - base-typescript

controls:
  model: anthropic/claude-sonnet-4
  environment:
    TEAM_MODE: engineering
```

The exact stable schema is governed by the requirements in `requirements/` and the JSON Schema files in `src/schemas/`, which are still expected to evolve with implementation.

## Design direction

The current recommendation is to build `applepi` around pi's existing native configuration mechanisms:

1. Use a temporary composite profile directory as `PI_CODING_AGENT_DIR` for each run.
2. Persist intentional pi state through adapter-declared symlinks to profile, native pi, or ApplePi cache files. Native pi fallback is only a durable target for declared state symlinks; it is not an inherited base profile layer.
3. Layer profile-controlled environment variables and pi CLI flags on top.
4. Use explicit `--extension` / `-e` injection for bootstrap behavior that needs to run inside pi.
5. Decide per profile whether project-local `.pi` overrides are allowed.
6. Keep the wrapper responsible for anything that must happen before pi starts, such as selecting config directories, setting credentials, or choosing session locations.

See [`recommendation.md`](./recommendation.md) for current notes on pi startup behavior and wrapper strategy.

## Status

This repository is under phased implementation.

A minimal executable CLI exists, with initial settings/profile schemas, local and URI-backed profile loading, profile resolution internals, first-pass `setup`, `sync`, `profile list`, and `profile create` commands, and a first-pass `run` command for assembling a temporary composite profile and launching pi or Claude Code.
Stable end-to-end pi launch behavior and user-facing examples will be hardened in a later phase.
The initial dependency and architecture decisions are documented in `package.json`, `doc/architecture.md`, and `requirements/`.

## Future work

- Define a stable profile schema.
- Decide where organization-managed profiles are discovered from.
- Harden stable `applepi run --profile <profile>` behavior.
- Add validation and inspection commands.
- Expand user-facing documentation for resolved profile inheritance and composition.
- Add locking / policy controls for business-managed environments.
- Add examples for common organizational deployments.
