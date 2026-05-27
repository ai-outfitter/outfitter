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

A future launch flow might look like:

```bash
bridl run engineering-default
bridl run support --cwd ~/work/customer-issue
bridl list profiles
bridl inspect regulated
```

Under the hood, `bridl` will translate a selected profile into the appropriate `pi` launch environment, such as `PI_CODING_AGENT_DIR`, CLI flags, injected extensions, prompts, model settings, session directories, and environment variables.

## Profile model sketch

A profile will likely describe some combination of:

```json
{
  "name": "engineering-default",
  "agentDir": "~/.bridl/profiles/engineering-default/pi-agent-dir",
  "env": {
    "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY}"
  },
  "args": [
    "--model", "anthropic/claude-sonnet-4"
  ],
  "extensions": [
    "./extensions/company-bootstrap"
  ],
  "skills": [
    "./skills/company-debugging"
  ],
  "systemPrompt": "./prompts/system.md",
  "appendSystemPrompt": [
    "./prompts/company-policy.md"
  ],
  "sessionDir": "~/.bridl/sessions/engineering-default",
  "projectOverrides": "allow"
}
```

This is only a sketch, not a committed schema.

## Design direction

The current recommendation is to build `bridl` around pi's existing native configuration mechanisms:

1. Use profile-specific `PI_CODING_AGENT_DIR` values as the main isolation boundary.
2. Layer profile-controlled environment variables and pi CLI flags on top.
3. Use explicit `--extension` / `-e` injection for bootstrap behavior that needs to run inside pi.
4. Decide per profile whether project-local `.pi` overrides are allowed.
5. Keep the wrapper responsible for anything that must happen before pi starts, such as selecting config directories, setting credentials, or choosing session locations.

See [`recommendation.md`](./recommendation.md) for current notes on pi startup behavior and wrapper strategy.

## Status

This repository is currently a skeleton. The README exists primarily to preserve project intent for future development and future agent sessions.

No CLI implementation or stable profile schema exists yet.

## Future work

- Define a stable profile schema.
- Decide where organization-managed profiles are discovered from.
- Implement `bridl run <profile>`.
- Add validation and inspection commands.
- Add support for profile inheritance or composition.
- Add locking / policy controls for business-managed environments.
- Add examples for common organizational deployments.
