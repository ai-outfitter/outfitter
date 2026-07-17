# Agent profiles

"Profile" is a description, not a resource or a settings key. There is no `profile.yml`, no `profiles:` map, and no profile file format. What earlier drafts modeled as a standalone profile — a named selection of skills, subagents, model, and so on — is now just an [agent](./agents.md) and its loadout.

## Profiles are agents

An **agent profile** is the whole bundle an agent carries: its identity (`agent.md`) plus the loadout declared in that agent's frontmatter or `config.json` — skills, MCP servers, subagents, extensions, plugins, model, thinking level, and tool policy. When someone says "the engineer profile," they mean the `engineer` agent with everything it composes.

Folding profiles into agents removes a layer of indirection. Instead of a settings map that points at resources that point at an identity, one agent directory holds identity and loadout together, resolves by slug like any other resource, and is what you run:

```bash
outfitter run engineer
outfitter run engineer --harness claude
```

`outfitter list agents` shows every resolvable agent and where each resolves from, including shadowed IDs. Set `default_agent` in [settings](./settings.md) to choose what plain `outfitter` runs.

## Where the loadout lives

The loadout lives on the agent, not in settings. Add or change what an agent composes by editing that agent's `agents/<id>/agent.md` frontmatter or `config.json` — see [Agents](./agents.md#loadout-fields) for the field list. Because agents merge by ID across layers, a workspace or machine-local layer can override one field (swap the model, add an extension) without redefining the agent.

Settings ([settings.md](./settings.md)) is left with just resolution and launch concerns — `default_agent`, `default_harness`, `sources`, and state policy — not resource selection.

## Composing from a base

To share behavior across several agents, define a base agent and select it as a subagent, or keep shared operating context in the tree's `system-prompt.md` and `agents.md` so every agent inherits it. The [persona](./personas.md) convention builds on this: one base review agent, many interchangeable persona description documents fed as input.

## Migrating from authored profiles

Earlier Outfitter versions defined profiles as authored YAML files (`.outfitter/profiles/`, `profile.yml`, inheritance, `controls`). That system is removed with no compatibility mode. See the [migration reference](./migration.md) for the manual mapping from the legacy format to agents and their loadouts.
