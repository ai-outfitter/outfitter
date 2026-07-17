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

Outfitter launches agent CLIs; install the agents you plan to use separately. For the full walkthrough, see [Getting started](./docs/documentation/getting-started.md).

## Already have a `.agents/` directory?

Then you already have Outfitter configuration. Existing agents, skills, knowledge, and commands are referenced by slug with zero porting:

```yaml
# .agents/settings.yml
default_profile: engineer
profiles:
  engineer:
    personas: [engineer]
    skills: [wiki, research]
    subagents: [code-reviewer]
```

If your setup lives in `~/.claude` instead, Outfitter can port it into `~/.agents/` and symlink it back so Claude Code keeps working natively — see [Porting a Claude Code setup](./docs/documentation/porting-claude.md).

## The `.agents` protocol in 30 seconds

```text
.agents/
  agents.md            # shared operating context
  system-prompt.md     # base system prompt
  mcp.json             # MCP servers
  models.json          # model configuration
  agents/<id>/agent.md # identities — used as personas or subagents
  skills/<id>/...      # capability packages
  tasks/<id>/task.md   # named execution contracts
  knowledge/           # reference documents
  commands/            # slash commands
```

Layers merge by ID: `<project>/.agents/` over `~/.agents/` over pinned remote [catalogs](./docs/documentation/catalogs.md). A [profile](./docs/documentation/profiles.md) is a named selection from the merged set; a [persona](./docs/documentation/personas.md) is the identity a run composes; a [task](./docs/documentation/tasks.md) is a repeatable objective that can be [baked](./docs/documentation/dump-and-bake.md) and run anywhere — including [GitHub Actions](./docs/documentation/actions.md).

## Documentation

- [Getting started](./docs/documentation/getting-started.md)
- [Concepts](./docs/documentation/concepts.md)
- [Settings](./docs/documentation/settings.md)
- [Profiles](./docs/documentation/profiles.md) · [Personas](./docs/documentation/personas.md) · [Subagents](./docs/documentation/subagents.md)
- [Agents](./docs/documentation/agents.md) · [Skills](./docs/documentation/skills.md) · [Tasks](./docs/documentation/tasks.md)
- [Catalogs](./docs/documentation/catalogs.md) · [Dump and bake](./docs/documentation/dump-and-bake.md)
- [Running tasks in GitHub Actions](./docs/documentation/actions.md)
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
