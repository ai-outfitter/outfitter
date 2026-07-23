# Concepts

How an `outfitter` launch goes from configuration files to a running agent:

```mermaid
flowchart LR
  settings[Settings] --> sources[Sources]
  sources --> layers[".agents layers"]
  layers --> resolver[Resolver]
  resolver --> composed["Composed agent"]
  composed --> adapter[Adapter]
  adapter --> harness[Harness]
```

Settings tell Outfitter where `.agents` resources come from; sources supply protocol resource trees; the resolver merges the layered trees into one effective resource set; the selected agent composes its loadout — skills, subagents, model, and so on — from that set by slug; and an adapter projects the composed agent into harness-specific files, flags, and environment variables before launching the harness (pi or Claude Code).

## The `.agents` protocol

Outfitter stores and exchanges all agent configuration in the vendor-neutral [Dotagents `.agents` protocol](https://dotagentsprotocol.com/) (pinned at revision [`502a9d5`](https://github.com/aj47/dotagentsprotocol-website/blob/502a9d5f886d0aad8d3da83c03354bdfa4b389e7/src/components/Structure.astro)). Outfitter does not define its own authored configuration format: a `.agents/` tree is useful without Outfitter, and any existing `.agents/` tree is usable by Outfitter without conversion.

```text
.agents/
  agents.md            # shared operating context
  system-prompt.md     # base system prompt
  mcp.json             # MCP server configuration
  models.json          # model configuration
  agents/<id>/agent.md # agent definitions (+ optional config.json)
  agents/<id>/skills/  # skills private to one agent (also knowledge/, commands/)
  agents/<id>/mcp.json # per-agent MCP config (discovered; projection deferred, #183)
  agents/<id>/hooks/   # reserved namespace (not yet resolved)
  skills/<id>/...      # Agent Skills packages
  tasks/<id>/task.md   # named execution contracts
  knowledge/...        # reference documents
  commands/...         # slash commands
```

## Resources

The protocol resources Outfitter resolves and composes:

- **Agent** — a definition at `agents/<id>/agent.md` (plus optional `config.json`) describing an identity _and_ its loadout: the skills, subagents, MCP servers, extensions, plugins, model, thinking level, and tools it runs with. The agent is what you run. See [Agents](./agents.md).
- **Skill** — a capability package under catalog-wide `skills/<id>/` or agent-local `agents/<agent-id>/skills/<id>/`, with instructions, references, scripts, and assets. See [Skills](./skills.md).
- **Knowledge** and **commands** — reference documents and slash commands shared across runs.

> Tasks — `tasks/<id>/task.md` execution contracts, structured inputs, and baking — are the subject of a separate upcoming RFC and are not part of this end state. See [Tasks](./tasks.md).

## Profiles, personas, and subagents

Three related terms, none of which is a settings key or a separate file format:

- A **[profile](./profiles.md)** is just an agent and its loadout. "The engineer profile" is the `engineer` agent with everything it composes. There is no `profile.yml` and no `profiles:` map — the loadout lives on the agent.
- A **[persona](./personas.md)** is a _convention_, not a resource: a base review agent (a base prompt plus how-to-review instructions) that reads an interchangeable persona description document — for example `docs/user-personas/coyote-road-runner-chaser.md` — as input. Swapping the input document swaps the persona.
- A **[subagent](./subagents.md)** is an agent projected into the harness's native delegation mechanism, selected in another agent's `subagents` loadout. A leader agent delegates to local coding-harness subagents or to issue- and action-backed subagents.

The same agent definition can be run directly or selected as a subagent elsewhere; its loadout decides what it composes.

## Layers

Resources resolve across layers, following the protocol's overlay semantics:

1. `<project>/.agents/` — the workspace layer, committed with a project.
2. `~/.agents/` — the global layer for one developer.
3. Remote sources — pinned `.agents` payloads from [catalog repositories](./catalogs.md), in configured order.

Resources merge **by ID**: a workspace `skills/wiki/` overrides a global or remote `skills/wiki/`. Agent-local skills merge by owner and ID, so `agents/actions/skills/debug/` is distinct from `agents/reviewer/skills/debug/`; the selected agent's local winner takes precedence over catalog-wide `skills/debug/`. JSON files such as `mcp.json` and `models.json` follow the protocol's JSON merge behavior. Standalone `.agents` repositories — where the repository root _is_ the payload — are the primary way to develop and share layers; see [Catalogs](./catalogs.md) and [Local development](./local-development.md).

## Settings scopes

Outfitter's own settings live inside the `.agents` tree as `settings.yml`, with a flat, gitignored `settings.local.yml` beside it for personal machine-local overrides:

- `~/.agents/settings.yml` — user defaults, plus optional `~/.agents/settings.local.yml`.
- `<project>/.agents/settings.yml` — committed project settings.
- `<project>/.agents/settings.local.yml` — personal, uncommitted overrides for that project. This flat file replaces the old nested project-local directory scope.

Settings declare the default agent and harness, resource sources, and launch behavior — not resource selection, which lives on the agent. Removing the settings files leaves a pure protocol tree. See [Settings](./settings.md).

## One resolver

Listing, validation, running, and dumping all share one resolver. What `outfitter list` shows is what `outfitter run` launches and what `outfitter dump` writes. See [Dump](./dump-and-bake.md).

## Adapters

An adapter projects composed resources into one agent CLI's native configuration — files, command-line flags, and environment variables. Pi is the primary and most complete adapter; a Claude Code adapter is supported with gaps. When an adapter cannot honor part of a composition it warns to stderr, or fails when `--strict` is set. See the [adapter support matrix](./support-matrix.md).

## State persistence

Agents write state during a run — auth, native settings, plugins, sessions. Each adapter declares the state paths it understands and how writes are handled (`symlink`, `discard`, `warn`, `error`, or `prompt`), so useful state survives future runs. See [State persistence](./state.md).

## Layer precedence

When several layers define the same resource ID or setting, higher layers win:

1. Project-local settings (`<project>/.agents/settings.local.yml`)
2. Project (`<project>/.agents/`)
3. User (`~/.agents/`, with `settings.local.yml` above `settings.yml`)
4. Cached remote sources (in configured source order)
5. Built-in defaults
