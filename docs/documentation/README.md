# Outfitter documentation

User-facing Outfitter documentation. These docs describe the [RFC #165](https://github.com/ai-outfitter/outfitter/issues/165) dotagents end state.

## Getting started

- [Getting started](./getting-started.md)
- [Concepts](./concepts.md)
- [CLI reference](./cli.md)
- [First-time CLI agent users](./first-time-cli-agent-users.md)

## Core concepts

- [Settings](./settings.md) — Scopes, schema, and the flat `settings.local.yml` override file.
- [Profiles](./profiles.md) — Named selections of resources composed by slug.
- [Personas](./personas.md) — Protocol agents composed in order as a run's identity.
- [Subagents](./subagents.md) — Protocol agents projected as harness delegates.
- [Agents](./agents.md) — The `agents/<id>/agent.md` resource itself.
- [Skills](./skills.md) — Capability packages with progressive disclosure, references, and routing.
- [Tasks](./tasks.md) — Lightweight execution contracts that select personas, skills, and jobs.

## Operations

- [Catalogs](./catalogs.md) — Publish and consume shareable `.agents` payloads; standalone and colocated layouts.
- [Dump and bake](./dump-and-bake.md) — Immutable task artifacts and deterministic `.agents/` dumps.
- [Running tasks in GitHub Actions](./actions.md)
- [Hooks](./hooks.md) — Harness hook wiring and the protocol gap.
- [State persistence](./state.md)
- [Adapter support matrix](./support-matrix.md)

## Adopting Outfitter

- [Switching to Outfitter](./switching-to-outfitter.md)
- [Porting a Claude Code setup](./porting-claude.md) — Port `~/.claude` into `~/.agents/` with a symlink back.
- [Local dotagents development](./local-development.md) — A personal standalone `.agents` repo that trickles upstream.
- [Migration from legacy profiles](./migration.md)
- [Iterating on profiles](./iterating-on-profiles.md)
- [Best practices](./best-practices.md)
- [Philosophy](../philosophy.md)

## Use cases

- [Organization catalog](./usecases/organization-profile-catalog.md) — Publish shared org resources and defaults through an `owner/.outfitter` control repository.
- [Engineering catalog](./usecases/engineering.md) — Package engineering personas, skills, and tasks for repeatable workflows.
- [Persona reviews](./usecases/persona-reviews.md) — Compose customer personas to get feedback on ideas, documentation, and designs.
