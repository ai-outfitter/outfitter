# Outfitter

Outfitter is the toolchain for the [Dotagents `.agents` protocol](https://dotagentsprotocol.com/): it resolves agent configuration from local and remote `.agents` trees, composes personas, skills, and tasks by slug, bakes tasks into deterministic execution artifacts, and launches the result through wrapped agent CLIs like [`pi`](https://github.com/earendil-works/pi-coding-agent) and Claude Code.

Outfitter does not own a configuration format. Your `.agents/` directory is the source of truth — useful without Outfitter, committed and reviewed like any other code.

> **Status:** these docs describe the target architecture of [RFC #165](https://github.com/ai-outfitter/outfitter/issues/165) (protocol revision `502a9d5`). Implementation is landing as a chain of PRs; the released CLI still runs the legacy profile system until then.

## Quick start

Run without installing:

```bash
npx @ai-outfitter/outfitter
```

Full install:

```bash
npm install -g @ai-outfitter/outfitter
outfitter
```

Pi is bundled and also hosts Outfitter's setup walkthrough. Install other runtime harnesses, such as
Claude Code, separately. For the full walkthrough, see [Getting started](./docs/documentation/getting-started.md).

## Already have a `.agents/` directory?

Then you already have Outfitter configuration. Each agent's loadout references your existing skills, subagents, MCP, knowledge, and commands by slug with zero porting:

```
<!-- .agents/agents/engineer/agent.md -->
---
name: engineer
skills: [wiki, research]
subagents: [code-reviewer]
mcp: [github]
---
```

```yaml
# .agents/settings.yml
default_agent: engineer
```

`outfitter setup` restores the original Pi-native profile-catalog walkthrough on top of `.agents`:
choose the default Outfitter catalog, create your own profile, or provide another catalog, then pick
the home/project target and default CLI agent. The default picker is fetched from the immutable
`ai-outfitter/default-profiles` Release Please tag pinned by Outfitter—never from a sibling checkout.
Managed porting and persistent harness symlinks are deferred to
[#187](https://github.com/ai-outfitter/outfitter/issues/187).

## The `.agents` protocol in 30 seconds

```text
.agents/
  agents.md            # shared operating context
  system-prompt.md     # base system prompt
  mcp.json             # MCP servers
  models.json          # model configuration
  agents/<id>/agent.md # identities + loadouts — run directly or as subagents
  skills/<id>/...      # capability packages
  knowledge/           # reference documents
  commands/            # slash commands
```

Layers merge by ID: `<project>/.agents/` over `~/.agents/` over pinned remote [catalogs](./docs/documentation/catalogs.md). An [agent](./docs/documentation/agents.md) carries both its identity and its loadout — an [agent profile](./docs/documentation/profiles.md) — and is what you run; a [persona](./docs/documentation/personas.md) is a review convention layered on a base agent; a [subagent](./docs/documentation/subagents.md) is an agent a run delegates to, including through [GitHub Actions](./docs/documentation/actions.md).

## Documentation

- [Getting started](./docs/documentation/getting-started.md)
- [Concepts](./docs/documentation/concepts.md)
- [Settings](./docs/documentation/settings.md)
- [Agents](./docs/documentation/agents.md) · [Agent profiles](./docs/documentation/profiles.md) · [Personas](./docs/documentation/personas.md) · [Subagents](./docs/documentation/subagents.md)
- [Skills](./docs/documentation/skills.md) · [Tasks (future RFC)](./docs/documentation/tasks.md)
- [Federated context](./docs/documentation/federated-context.md)
- [Catalogs](./docs/documentation/catalogs.md) · [Dump](./docs/documentation/dump-and-bake.md)
- [Running an agent in GitHub Actions](./docs/documentation/actions.md)
- [Hooks](./docs/documentation/hooks.md) · [State persistence](./docs/documentation/state.md)
- [Adapter support matrix](./docs/documentation/support-matrix.md)
- [Local dotagents development](./docs/documentation/local-development.md)
- [Switching to Outfitter](./docs/documentation/switching-to-outfitter.md) · [Migration from legacy profiles](./docs/documentation/migration.md)
- [Documentation index](./docs/documentation/README.md)

Use cases:

- [Organization catalog](./docs/documentation/usecases/organization-profile-catalog.md) — Publish shared org resources and defaults through an `owner/.outfitter` control repository.
- [Engineering catalog](./docs/documentation/usecases/engineering.md) — Package engineering personas, skills, and tasks for repeatable workflows.
- [Persona reviews](./docs/documentation/usecases/persona-reviews.md) — Compose customer personas to get feedback on ideas, documentation, and designs.

For local development, repository structure, and release workflow details, see [Contributing](./CONTRIBUTING.md).
