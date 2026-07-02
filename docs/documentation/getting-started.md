# Getting started

Install Outfitter globally:

```bash
npm install -g @ai-outfitter/outfitter
outfitter --help
```

Outfitter launches agent CLIs; install the agents you plan to use separately.

## First-time setup

Set up profiles from the Outfitter [default profiles repo](https://github.com/ai-outfitter/default-profiles), then launch the default profile:

```bash
outfitter setup
outfitter
```

If you are new to Claude Code, Codex, Pi, and agent CLIs, start with [First-time CLI agent users](./first-time-cli-agent-users.md) for YOLO mode, permissions, context engineering, planning mode, subagents, skills, and extension basics. If you already have an agent workflow, use [Switching to Outfitter](./switching-to-outfitter.md) to migrate the smallest durable set of habits first.

Learn how shared setup sources work in [Profile repositories](./profile-repository.md), then see [Profiles](./profiles.md) for profile composition, inheritance, and prompt examples.

### Using Claude Code

Claude Code is a peer adapter with its own first-run flow. On a fresh machine:

```bash
outfitter run --agent claude
```

- **First run** — with no Outfitter settings yet, a terminal-side profile picker syncs the default profile catalog, lets you choose a default profile, and writes `~/.outfitter/settings.yml` with `default_agent: claude` before launching Claude Code. If the catalog cannot be reached, onboarding continues offline with the built-in `starter` profile; `outfitter sync` upgrades to the full catalog later.
- **Claude Code not installed** — Outfitter prints install guidance (`npm install -g @anthropic-ai/claude-code`, or `brew install --cask claude-code` on macOS) instead of a bare launch error.
- **Login** — Claude Code owns its own login: launch it and run `/login` inside the session if it reports you are not logged in. Outfitter never reads or stores Claude credentials; it only prints a `/login` hint when no prior login state is detectable.

## Common commands

```bash
outfitter run --profile engineering-default
outfitter run --agent claude --profile support
outfitter sync
outfitter profile list
outfitter profile create regulated --scope user
```

See the [CLI reference](./cli.md) for every command and flag, and [Concepts](./concepts.md) for how settings, profiles, and adapters fit together. (`outfitter welcome` also exists as a legacy compatibility command for the older terminal onboarding prompts; current onboarding runs inside Pi via `outfitter setup`.)

## Other install options

Upgrade a global install:

```bash
npm update -g @ai-outfitter/outfitter
```

Try without a global install:

```bash
npx --yes @ai-outfitter/outfitter@latest --help
```
