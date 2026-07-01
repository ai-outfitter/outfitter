# Outfitter

Outfitter builds effective agent profiles and launches them through wrapped agent CLIs like [`pi`](https://github.com/earendil-works/pi-coding-agent), Claude Code, and future adapters. Individuals, teams, and organizations can share and compose repeatable agent profiles.

If you have not tried [Pi](https://pi.dev) yet, Outfitter is the quickest path to a recommended Pi loadout for engineering work.

## Quick start

```bash
npm install -g @ai-outfitter/outfitter
outfitter setup
outfitter
```

Outfitter launches agent CLIs; install the agents you plan to use separately.

For the full walkthrough, see [Getting started](./docs/documentation/getting-started.md).

## Profiles

[Profiles](./docs/documentation/profiles.md) compose the context, tools, prompts, skills, extensions, subagents, and DeepWork workflows that shape an agent. Profiles can be shared using [Profile Catalog Repos](./docs/documentation/profile-repository.md).

```yaml
# ~/.outfitter/profiles/home-default.yml
id: home-default
label: Home Default
description: Reusable personal defaults for Outfitter-managed Pi runs.
controls:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
  append_system_prompt:
    - |
      Use concise, evidence-backed engineering prose.
      Prefer small, reviewable changes.
      Keep durable decisions in repo files.
    - repo_file: docs/architecture.md
```

## Documentation

- [Getting started](./docs/documentation/getting-started.md)
- [Profiles](./docs/documentation/profiles.md)
- [Profile repositories](./docs/documentation/profile-repository.md)
- [State persistence](./docs/documentation/state.md)
- [First-time CLI agent users](./docs/documentation/first-time-cli-agent-users.md)
- [Switching to Outfitter](./docs/documentation/switching-to-outfitter.md)
- [Documentation index](./docs/documentation/README.md)

Use cases:

- [Organization profile catalog](./docs/documentation/usecases/organization-profile-catalog.md) — Publish shared team roles so new users can start with organization-approved defaults.
- [Engineering profile catalog](./docs/documentation/usecases/engineering.md) — Package coding, platform, and review profiles for repeatable engineering workflows.
- [Persona reviews](./docs/documentation/usecases/persona-reviews.md) — Create customer personas to get feedback on ideas, documentation, and designs.

For local development, repository structure, and release workflow details, see [Contributing](./CONTRIBUTING.md).
