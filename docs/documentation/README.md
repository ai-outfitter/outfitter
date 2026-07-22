# Outfitter documentation

User-facing Outfitter documentation. These docs describe the [RFC #165](https://github.com/ai-outfitter/outfitter/issues/165) dotagents end state.

## Getting started

- [Getting started](./getting-started.md)
- [Concepts](./concepts.md)
- [CLI reference](./cli.md)
- [First-time CLI agent users](./first-time-cli-agent-users.md)

## Core concepts

- [Settings](./settings.md) — Scopes, schema, and the flat `settings.local.yml` override file.
- [Agents](./agents.md) — The `agents/<id>/agent.md` resource and its loadout — what you run.
- [Agent profiles](./profiles.md) — Why an agent and its loadout _is_ the profile.
- [Personas](./personas.md) — The base-agent-plus-persona-documents review convention.
- [Subagents](./subagents.md) — Agents projected as harness delegates; leader-agent delegation.
- [Skills](./skills.md) — Capability packages with progressive disclosure, references, and routing.
- [Federated context](./federated-context.md) — Governed atomic context skills selected by thin agents.
- [Tasks](./tasks.md) — Placeholder for a separate upcoming RFC.

## Operations

- [Catalogs](./catalogs.md) — Publish and consume shareable `.agents` payloads; standalone and colocated layouts.
- [Dump](./dump-and-bake.md) — Deterministic, self-contained `.agents/` dumps.
- [Running an agent in GitHub Actions](./actions.md)
- [Hooks](./hooks.md) — Harness hook wiring and the protocol gap.
- [State persistence](./state.md)
- [Adapter support matrix](./support-matrix.md)

## Adopting Outfitter

- [Switching to Outfitter](./switching-to-outfitter.md)
- [Porting a Claude Code setup](./porting-claude.md) — Port `~/.claude` into `~/.agents/` with a symlink back.
- [Local dotagents development](./local-development.md) — A personal standalone `.agents` repo that trickles upstream.
- [Migration from legacy profiles](./migration.md)
- [Iterating on an agent](./iterating-on-profiles.md)
- [Best practices](./best-practices.md)
- [Philosophy](../philosophy.md)

## Use cases

- [Organization catalog](./usecases/organization-profile-catalog.md) — Publish shared org resources and defaults through an `owner/.outfitter` control repository.
- [Engineering catalog](./usecases/engineering.md) — Package engineering agents and skills for repeatable workflows.
- [Persona reviews](./usecases/persona-reviews.md) — A base review agent plus customer-persona documents for feedback on ideas, docs, and designs.
- [Federated context](./federated-context.md) — Share codebase, team, tool, and model context without loading the whole organization.
