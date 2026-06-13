_pre-launch | internal tool preview._

# applepi

`applepi` is intended to be a management wrapper for launching [`pi`](https://github.com/earendil-works/pi-coding-agent) and Claude Code with configurable, reusable profiles.

The goal is manageable agent CLI configuration: 
- Organizations can define standard pi or claude loadouts, share them, and launch agent CLIs consistently across different environments.
- Individuals can swap between configurations of their coding agent, share those, and easily migrate to new machines.

If you haven't tried [Pi](https://pi.dev) yet — we think it's a great coding harness & ApplePi is an easy way to try it.
- Install and run `applepi` to load pi with our standard configuration for engineers.

## Install

### Agent-assisted setup

Using a CLI coding agent (Claude Code, pi, etc.)? Copy this prompt and paste it into your agent:

<details>
<summary>Setup prompt</summary>

```text
Install applepi globally: clone https://github.com/applepi-ai/applepi into a
sensible location (e.g. ~/repos) unless I already have a checkout, run
npm install, then npm run dev_install to build and npm-link the global
applepi command. Verify applepi is on PATH. Then check whether the pi coding
agent (https://github.com/earendil-works/pi-coding-agent) is installed; if
not, install it per its README. Report what was installed and any PATH
changes I need.
```

</details>

### Manual install

ApplePi is not yet published to npm, so install it from source:

```bash
git clone https://github.com/applepi-ai/applepi
cd applepi
npm install
npm run dev_install
```

`npm run dev_install` builds the CLI and links it globally via `npm link`, so `applepi` is on your PATH and rebuilds in this checkout take effect immediately.

ApplePi launches agent CLIs but does not install them. Install the agents you plan to use separately:

- [pi](https://github.com/earendil-works/pi-coding-agent) — follow its installation instructions; the `pi` command must be on your PATH.
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) — only needed if you launch with `--agent claude`.

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

<details>
<summary>Full example profile with supported fields</summary>

```yaml
# Profile identity used by commands, logs, cache keys, and documentation.
id: engineering
label: Engineering

# Optional ordered parent profiles. Parent controls are lower precedence than this profile.
inherits:
  - base-typescript

# Optional per-state-path persistence overrides. Paths must be declared by the selected adapter.
state_persistence:
  settings.json: warn

# Generic controls apply to every adapter unless an adapter-specific block overrides them.
controls:
  # Model/provider settings select the backing LLM and provider behavior.
  model: anthropic/claude-sonnet-4
  provider: anthropic
  thinking: medium

  # Extra CLI arguments and runtime directories for the selected adapter.
  args:
    - --some-arg
  session_directory: ./sessions

  # Profile-owned extensions and skills add runtime capabilities and task instructions.
  extensions:
    - npm:pi-subagents
  skills:
    - ./skills/debugging

  # Use prompt_template for a reusable task workflow, such as code review or implementation planning.
  prompt_template: ./prompts/implementation-plan.md

  # Use system_prompt for the agent's core behavior; append_system_prompt adds standing rules on top.
  system_prompt: ./prompts/engineering-agent.md
  append_system_prompt: ./prompts/company-policy.md

  # Environment variables injected into the agent process.
  environment:
    TEAM_MODE: engineering

  # Pi-specific controls override or extend the generic controls when running the pi adapter.
  pi:
    model: anthropic/claude-sonnet-4
    provider: anthropic
    thinking: medium
    args:
      - --thinking
      - medium
    session_directory: ./pi-sessions
    extensions:
      - git:github.com/applepi-ai/deepwork
    skills:
      - ./skills/pi-debugging
    prompt_template: ./prompts/pi-code-review.md
    system_prompt: ./prompts/pi-engineering-agent.md
    append_system_prompt: Pi-specific instructions
    environment:
      PI_TEAM_MODE: engineering

  # Claude-specific controls override or extend the generic controls when running the claude adapter.
  claude:
    model: claude-sonnet-4
    provider: anthropic
    thinking: medium
    args:
      - --verbose
    session_directory: ./claude-sessions
    extensions:
      - ./extensions/claude-bootstrap
    skills:
      - ./skills/claude-debugging
    prompt_template: ./prompts/claude-code-review.md
    system_prompt: ./prompts/claude-engineering-agent.md
    append_system_prompt: Claude-specific instructions
    environment:
      CLAUDE_TEAM_MODE: engineering
```

A profile is stored as `profile.yml` inside a profile directory, for example `profiles/engineering/profile.yml`.
The complete schema is defined in `src/schemas/profile.schema.json`.

</details>

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
The initial dependency and architecture decisions are documented in `package.json`, `docs/architecture.md`, and `requirements/`.

## Future work

- Define a stable profile schema.
- Decide where organization-managed profiles are discovered from.
- Harden stable `applepi run --profile <profile>` behavior.
- Add validation and inspection commands.
- Expand user-facing documentation for resolved profile inheritance and composition.
- Add locking / policy controls for business-managed environments.
- Add examples for common organizational deployments.
