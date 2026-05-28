# bridl

`bridl` is intended to be a management wrapper for launching [`pi`](https://github.com/earendil-works/pi-coding-agent) with configurable, reusable profiles.

The goal is "manageable pi": organizations should be able to define standard pi loadouts, distribute them to their workforce, and launch pi consistently across teams, roles, projects, or environments.

## Why this exists

Pi is highly configurable through settings directories, extensions, skills, prompts, themes, model settings, environment variables, and CLI flags. That flexibility is powerful, but businesses often need a higher-level control plane for repeatable deployments.

`bridl` should make it easy to answer questions like:

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
bridl
bridl run --profile engineering-default
bridl run -p support -- --cwd ~/work/customer-issue
bridl sync
bridl setup
bridl create_profile regulated --scope user
```

Under the hood, `bridl` will translate a selected profile into the appropriate `pi` launch environment, such as `PI_CODING_AGENT_DIR`, CLI flags, injected extensions, prompts, model settings, session directories, and environment variables.

## Profile model sketch

A profile will use YAML. An initial profile shape is:

```yaml
id: engineering-default
label: Engineering Default
inherits:
  - base-typescript

controls:
  model: anthropic/claude-sonnet-4
  environment:
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

The exact stable schema is governed by the requirements in `requirements/` and the JSON Schema files in `src/schemas/`, which are still expected to evolve with implementation.

## Design direction

The current recommendation is to build `bridl` around pi's existing native configuration mechanisms:

1. Use profile-specific `PI_CODING_AGENT_DIR` values as the main isolation boundary.
2. Layer profile-controlled environment variables and pi CLI flags on top.
3. Use explicit `--extension` / `-e` injection for bootstrap behavior that needs to run inside pi.
4. Decide per profile whether project-local `.pi` overrides are allowed.
5. Keep the wrapper responsible for anything that must happen before pi starts, such as selecting config directories, setting credentials, or choosing session locations.

See [`recommendation.md`](./recommendation.md) for current notes on pi startup behavior and wrapper strategy.

## Status

This repository is under phased implementation.

A minimal executable CLI shell exists, with initial settings/profile schemas, local profile loading and resolution internals, and first-pass `setup`, `sync`, and `create_profile` / `create-profile` commands. The `run` command and stable end-to-end pi launch behavior are still in progress. The initial dependency and architecture decisions are documented in `package.json`, `doc/architecture.md`, and `requirements/`.

## Future work

- Define a stable profile schema.
- Decide where organization-managed profiles are discovered from.
- Implement stable `bridl run --profile <profile>` behavior.
- Add validation and inspection commands.
- Wire resolved profile inheritance and composition into user-facing commands.
- Add locking / policy controls for business-managed environments.
- Add examples for common organizational deployments.
