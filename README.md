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
# ~/.outfitter/profiles/home-default/profile.yml
id: home-default
label: Home Default
description: Reusable personal defaults for Outfitter-managed Pi runs.
controls:
  provider: openai-codex
  model: gpt-5.5
  thinking: high
  append_system_prompt: |
    Use concise, evidence-backed engineering prose.
    Prefer small, reviewable changes.
    Keep durable decisions in repo files.
```

## Repository map

| Path                                            | Use it for                                               |
| ----------------------------------------------- | -------------------------------------------------------- |
| [Documentation](./docs/documentation/README.md) | User-facing setup, profile, and profile-repository docs. |
| [Architecture](./docs/archtecture/README.md)    | Architecture, runtime design, and internal conventions.  |
| [Requirements](./docs/requirements/)            | Formal OFTR requirements.                                |
| [CLI package](./code/cli/)                      | Published CLI package source, tests, skills, and config. |
| [Pi extension](./code/pi-extension/)            | Future Pi extension package boundary.                    |
| [Contributing](./CONTRIBUTING.md)               | Local development and release workflow.                  |
| [Changelog](./CHANGELOG.md)                     | Release history.                                         |
| [License](./LICENSE.md)                         | License terms.                                           |
