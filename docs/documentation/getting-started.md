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
