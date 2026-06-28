# outfitter

`outfitter` is intended to be a management wrapper for launching [`pi`](https://github.com/earendil-works/pi-coding-agent) and Claude Code with configurable, reusable profiles.

The goal is manageable agent CLI configuration:

- Organizations can define standard pi or claude loadouts, share them, and launch agent CLIs consistently across different environments.
- Individuals can swap between configurations of their coding agent, share those, and easily migrate to new machines.

If you haven't tried [Pi](https://pi.dev) yet — we think it's a great coding harness & Outfitter is an easy way to try it.

- Install and run `outfitter` to load pi with our standard configuration for engineers.

## Install

Install Outfitter globally from npm so the `outfitter` command is available on your PATH:

```bash
npm install -g @ai-outfitter/outfitter
outfitter --help
```

Upgrade with:

```bash
npm update -g @ai-outfitter/outfitter
```

Use `npx` when you want to test Outfitter without adding a global command:

```bash
npx --yes @ai-outfitter/outfitter@latest --help
```

For source development, see [`CONTRIBUTING.md`](./CONTRIBUTING.md).

Outfitter launches agent CLIs but does not install them.
Install the agents you plan to use separately:

- [pi](https://github.com/earendil-works/pi-coding-agent) — follow its installation instructions; the `pi` command must be on your PATH.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — only needed if you launch with `--agent claude`.

## Why this exists

Pi is highly configurable through settings directories, extensions, skills, prompts, themes, model settings, environment variables, and CLI flags.
That flexibility is powerful, but businesses often need a higher-level control plane for repeatable deployments.

`outfitter` should make it easy to answer questions like:

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
outfitter
outfitter run --profile engineering-default
outfitter run -p support -- --cwd ~/work/customer-issue
outfitter sync
outfitter setup
outfitter setup https://github.com/my_account/outfitter_config
outfitter welcome
outfitter profile list
outfitter profile create regulated --scope user
```

Under the hood, `outfitter` translates a selected profile into the selected agent launch environment.
Pi runs use `PI_CODING_AGENT_DIR`; Claude Code runs use `CLAUDE_CONFIG_DIR`; both receive supported CLI flags, prompts, model settings, and environment variables.
Select the adapter with `outfitter run --agent <pi|claude>`, or set `default_agent` in `settings.yml`.
If neither is set, Outfitter defaults to pi for backward compatibility.
If `outfitter` is run before `outfitter setup`, it creates the initial settings and default profile automatically before launching.
When that first-run setup has an interactive terminal, Outfitter continues into the same welcome onboarding used by `outfitter welcome`.

`outfitter welcome` explains Outfitter and Pi, then asks one accept/decline question for the founder profile.
Accepting installs the founder role as the default plus the full recommended Pi productivity loadout without item-by-item prompts; `engineer` and `data_analyst` remain available later through `/outfitter`.
The recommended loadout includes `deepwork`, `@juicesharp/rpiv-ask-user-question`, `ulta-tasklist`, `pi-nolo`, `pi-browser-harness`, `@mjakl/pi-subagent`, `@narumitw/pi-btw`, `pi-must-have-extension`, `pi-interactive-shell`, and `pi-mcp-adapter`.
If Pi does not appear to be logged in after welcome onboarding, Outfitter opens interactive Pi launches with `/login` automatically; outside welcome onboarding it prints a `/login` reminder only for interactive launches.
Outfitter never collects or persists provider API keys itself.

`settings.yml` can point at local profiles, full Git URIs, or GitHub shorthand sources with optional refs and repository subpaths:

```yaml
remote_settings:
  - github: my_account/outfitter_config
    ref: main
    path: settings.yml

profile_sources:
  - github: my_account/outfitter_config
    ref: main
    path: profiles
```

Run `outfitter sync` to fetch/update remote settings and profiles before using them.

By default, Outfitter keeps reusable runtime cache files under `~/.outfitter/cache`.
Set `cache_directory` in `settings.yml` to choose a different cache root; relative values resolve from the settings file that declares them.
The pi adapter symlinks composite profile `utilities/` and `bin/` paths into this cache so pi-managed utilities such as `fd` and `rg` survive across temporary composite profile directories.

Settings can also define arbitrary nested `custom_settings` values for Outfitter-time composite profile templating:

```yaml
custom_settings:
  build_commands:
    lint: npm run lint
```

Generated composite profile files can reference them with Outfitter's LiquidJS-based custom delimiters:

```yaml
command: '[[= outfitter.custom_settings.build_commands.lint ]]'
```

Control tags use `[[% ... %]]`, for example `[[% for item in outfitter.custom_settings.items %]]`.
Outfitter intentionally does not use common `{{ ... }}` delimiters, and plain shell expressions like `[[ -f package.json ]]` are left alone.

## Setup from a settings repository

You can bootstrap a machine from a Git repository:

```bash
outfitter setup https://github.com/my_account/outfitter_config
```

`outfitter setup` requires an interactive terminal on both stdin and stdout.
When a repository is provided, it clones or updates the repository in Outfitter's shared repository cache, then uses it as a non-overwriting starting point:

- interactive setup-source onboarding shows the Outfitter welcome first, explains which source is being imported, asks whether to install profiles into user home or the current project, then asks one source-profile/default prompt;
- if the user chooses home and `~/.outfitter/settings.yml` does not exist, Outfitter copies the starter `settings.yml`;
- if the user chooses project and `<project>/.outfitter/settings.yml` does not exist, Outfitter copies the starter `settings.yml` and ensures `./profiles` is exposed;
- if starter profiles exist, Outfitter copies missing profile files into the selected `profiles/` folder;
- existing settings and profile files are otherwise left unchanged;
- after setup, Outfitter runs the same sync behavior used by `outfitter sync`, then offers to start with the selected default profile or shows both `outfitter` and `outfitter --profile <profile>` start commands;
- on initial interactive first-run setup, Outfitter skips the older default-profile prompt and lets welcome onboarding choose the generated local default profile;
- outside that initial welcome handoff and outside setup-source import onboarding, Outfitter shows a short setup wizard that lists synced profiles and writes the selected default profile to user settings;
- no-source interactive setup continues into welcome onboarding to record role and loadout choices.

A setup repository can use either root-level Outfitter files:

```text
outfitter_config/
  settings.yml
  profiles/
    engineering-default/
      profile.yml
    support/
      profile.yml
```

or a `.outfitter/` layout:

```text
outfitter_config/
  .outfitter/
    settings.yml
    profiles/
      engineering-default/
        profile.yml
      support.yml
    deepwork/
      jobs/
        project_milestone/
          job.yml
```

Example `settings.yml` for a setup repository:

```yaml
default_profile: engineering-default

profile_sources:
  - path: ./profiles

  # Optional: keep loading future updates from this same repo.
  - github: my_account/outfitter_config
    ref: main
    path: profiles
```

If you want ongoing centralized settings, use a small local `~/.outfitter/settings.yml` that points at remote settings:

```yaml
remote_settings:
  - github: my_account/outfitter_config
    ref: main
    path: settings.yml
```

Then run:

```bash
outfitter sync
```

When `outfitter setup <local-path>` points at a local setup repository, normal setup still imports a safe snapshot by caching/copying files into the selected user or project `.outfitter` directory. For rapid development of shared Outfitter profiles, interactive setup offers a symlink mode when the local source contains `.outfitter/`: the selected target `.outfitter` is linked to the source `.outfitter`, so edits in the shared profile repository affect subsequent Outfitter runs immediately. Use the default copy mode for isolation; use symlink mode when you intentionally want live iteration.

## Profile model sketch

A profile uses YAML. Profile sources support both directory and flat-file layouts:

```text
.outfitter/
  settings.yml
  profiles/
    engineering-default/
      profile.yml
    founder.yml
    support.yaml
  deepwork/
    jobs/
      project_milestone/
        job.yml
```

Directory profiles can bundle profile-owned resources under their own folder. Flat profiles use their filename stem as the fallback `id` when the YAML omits `id`; the stem must be a filesystem-safe profile id. Shared DeepWork jobs can live as siblings under `.outfitter/deepwork/jobs/` and can be selected by name from profile YAML.

An initial profile shape is:

```yaml
id: engineering-default
label: Engineering Default
description: General software engineering profile for coding, tests, reviews, and repo navigation.
inherits:
  - base-typescript
  - shared-prose

controls:
  model: anthropic/claude-sonnet-4
  environment:
    TEAM_MODE: engineering
```

Set `template: true` on profiles such as `shared-prose` that should only be inherited by runnable profiles, not selected directly with `outfitter run`.

The exact stable schema is governed by the requirements in `requirements/` and the JSON Schema files in `src/schemas/`, which are still expected to evolve with implementation.

Generated Pi prompt exports are default-off. Set top-level `profile_export: true` in `settings.yml` to export the fully built Pi runtime system prompt for every selected local profile, or set top-level `profile_export: true|false` in a profile to override that default for one profile. Directory profiles write `generated-system-prompt.md` inside the profile directory; flat profiles write `<profile-id>.generated-system-prompt.md` beside the flat YAML file. Outfitter seeds a deterministic pre-launch fallback and its Pi launch extension overwrites it from Pi runtime `ctx.getSystemPrompt()`, matching the same primitive used by `pi-inspect`; these files can be committed for PR review or git-ignored.

Profiles can also ship DeepWork jobs for that profile under `deepwork/jobs/`.
When Outfitter launches Pi, it adds contributing profile job folders to `DEEPWORK_ADDITIONAL_JOBS_FOLDERS` so the DeepWork frontend can discover profile-owned workflows without copying them into a project `.deepwork/jobs/` directory.
Profiles may also select shared Outfitter DeepWork jobs by name:

```yaml
controls:
  deepwork:
    jobs:
      - project_milestone
      - project_governance
```

Those names resolve to jobs already defined under shared roots such as `.outfitter/deepwork/jobs/project_milestone/job.yml`. By default, profiles with bundled or named jobs receive only their profile-selected jobs; set `controls.pi.allow_external_deepwork_jobs: true` to also include inherited `DEEPWORK_ADDITIONAL_JOBS_FOLDERS` entries.
Pi-specific job overrides remain supported under `cli_specific/pi/deepwork/jobs/`.

### Updating profile-managed Pi extensions

Profiles can request Pi extensions with `controls.pi.extensions`, for example:

```yaml
controls:
  pi:
    extensions:
      - git:github.com/ai-outfitter/deepwork
```

For normal users, extension updates should flow through the profile rather than
through hand-edited Pi cache directories:

1. If your profile is remote-managed, run `outfitter sync` to fetch the latest
   Outfitter settings and profile sources.
2. Confirm the active profile names the desired extension source, such as
   `git:github.com/ai-outfitter/deepwork` after a repository move.
3. Start a new Outfitter-managed Pi session with `outfitter` or
   `outfitter run --profile <profile>`. Restart any already-running Pi session;
   newly registered tools and extension code are only loaded when Pi starts or
   reloads resources.

`outfitter sync` updates Outfitter's own remote profile/settings cache. Pi still
owns installation and loading of the `git:` extension declared by the resolved
profile. Outfitter keeps Pi's `git/` and `tmp/` state paths persistent across
runs so installed extensions are reusable, but users should not need one-off
scripts that modify temporary extension cache paths.

If an extension still appears stale after syncing profiles and restarting Pi,
check the resolved profile first. A future Outfitter command may add a
first-class extension-cache refresh path, but direct cache surgery is a
troubleshooting fallback rather than the normal update flow.

## Design direction

The current recommendation is to build `outfitter` around pi's existing native configuration mechanisms:

1. Use a temporary composite profile directory as `PI_CODING_AGENT_DIR` for each run.
2. Persist intentional pi state through adapter-declared symlinks to profile, native pi, or Outfitter cache files.
   Native pi fallback is only a durable target for declared state symlinks; it is not an inherited base profile layer.
3. Layer profile-controlled environment variables and pi CLI flags on top.
4. Use explicit `--extension` / `-e` injection for bootstrap behavior that needs to run inside pi.
5. Decide per profile whether project-local `.pi` overrides are allowed.
6. Keep the wrapper responsible for anything that must happen before pi starts, such as selecting config directories, setting credentials, or choosing session locations.

## Status

This repository is under phased implementation.

A minimal executable CLI exists, with initial settings/profile schemas, local and URI-backed profile loading, profile resolution internals, first-pass `setup`, `sync`, `profile list`, and `profile create` commands, and a first-pass `run` command for assembling a temporary composite profile and launching pi or Claude Code.
Stable end-to-end pi launch behavior and user-facing examples will be hardened in a later phase.
The initial dependency and architecture decisions are documented in `package.json`, `doc/architecture.md`, and `requirements/`.

## Future work

- Define a stable profile schema.
- Decide where organization-managed profiles are discovered from.
- Harden stable `outfitter run --profile <profile>` behavior.
- Add validation and inspection commands.
- Expand user-facing documentation for resolved profile inheritance and composition.
- Add locking / policy controls for business-managed environments.
- Add examples for common organizational deployments.
