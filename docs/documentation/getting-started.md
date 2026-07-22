# Getting started

Install Outfitter globally:

```bash
npm install -g @ai-outfitter/outfitter
outfitter --help
```

Outfitter launches agent CLIs; install the agents you plan to use separately.

## Already have a `.agents/` directory?

You're most of the way there. Outfitter reads the [Dotagents `.agents` protocol](./concepts.md#the-agents-protocol) directly — your existing agents, skills, knowledge, and commands are usable by slug with no conversion:

```bash
outfitter list          # see what resolves from ~/.agents and <project>/.agents
outfitter run           # launch with your defaults
```

Set `default_agent` in `.agents/settings.yml` to one of your [agent](./agents.md) slugs; that agent's own loadout selects the skills, subagents, model, and so on it runs with. You're done.

If your configuration lives in `~/.claude` instead, `outfitter setup` can port it into `~/.agents/` and symlink it back so Claude Code keeps working natively — see [Porting a Claude Code setup](./porting-claude.md).

## First-time setup

Bootstrap from the Outfitter [default catalog](https://github.com/ai-outfitter/.agent), then launch the default agent:

```bash
outfitter setup
outfitter
```

If you are new to Claude Code, Codex, Pi, and agent CLIs, start with [First-time CLI agent users](./first-time-cli-agent-users.md). If you already have an agent workflow, use [Switching to Outfitter](./switching-to-outfitter.md) to adopt the smallest durable set first.

Learn how shared sources work in [Catalogs](./catalogs.md), then see [Agents](./agents.md), [Agent profiles](./profiles.md), and [Personas](./personas.md) for composition.

## Common commands

```bash
outfitter run engineer
outfitter run reviewer --harness claude
outfitter sync
outfitter list agents
outfitter validate
outfitter dump --out ./review
```

See the [CLI reference](./cli.md) for every command and flag, and [Concepts](./concepts.md) for how settings, resources, and adapters fit together.

## Other install options

Upgrade a global install:

```bash
npm update -g @ai-outfitter/outfitter
```

Try without a global install:

```bash
npx --yes @ai-outfitter/outfitter@latest --help
```

Run directly from the repository's Nix flake:

```bash
nix run github:ai-outfitter/outfitter -- --help
```
