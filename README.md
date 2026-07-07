# Outfitter

Outfitter builds effective agent profiles and launches them through wrapped agent CLIs like [`pi`](https://github.com/earendil-works/pi-coding-agent), Claude Code, and future adapters. Individuals, teams, and organizations can share and compose repeatable agent profiles.

If you have not tried [Pi](https://pi.dev) yet, Outfitter is the quickest path to a recommended Pi loadout for engineering work.

## Quick start

The first time outfitter runs it will start the setup flow to choose profiles and setup a model if pi is not already configured with one.

Run without installing.

```bash
npx @ai-outfitter/outfitter
```

Full install

```bash
npm install -g @ai-outfitter/outfitter
outfitter
```

Outfitter launches agent CLIs; install the agents you plan to use separately.

For the full walkthrough, see [Getting started](./docs/documentation/getting-started.md).

## Profiles

[Profiles](./docs/documentation/profiles.md) compose the context, tools, prompts, skills, extensions, subagents, and DeepWork workflows that shape an agent. Profiles can be shared using [Profile Catalog Repos](./docs/documentation/profile-repository.md).

The simplest useful profile is one YAML file with an appended system prompt. It works unchanged for every supported agent CLI:

```yaml
# ~/.outfitter/profiles/home-default.yml
label: Home Default
controls:
  append_system_prompt: |
    Use concise, evidence-backed engineering prose.
    Prefer small, reviewable changes.
```

```bash
outfitter run --profile home-default                 # launches pi (default)
outfitter run --profile home-default --agent claude  # launches Claude Code
```

Add agent-specific controls only when you need them:

```yaml
# ~/.outfitter/profiles/home-default.yml
label: Home Default
controls:
  thinking: high
  append_system_prompt:
    - |
      Use concise, evidence-backed engineering prose.
      Prefer small, reviewable changes.
      Keep durable decisions in repo files.
    - repo_file: docs/architecture.md
  pi:
    provider: openai-codex
    model: gpt-5.5
  claude:
    model: claude-sonnet-4-6
```

## Documentation

- [Getting started](./docs/documentation/getting-started.md)
- [What works today: adapter support matrix](./docs/documentation/support-matrix.md)
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
