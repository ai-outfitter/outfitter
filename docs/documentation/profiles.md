# Agent profiles

"Profile" is a description, not a resource or a settings key.
There is no `profile.yml`, no `profiles:` map, and no profile file format.
What earlier drafts modeled as a standalone profile — a named selection of skills, subagents, model, and so on — is now just an [agent](./agents.md) and its loadout.

## Profiles are agents

An **agent profile** is the whole bundle an agent carries: its identity (`agent.md`) plus the loadout declared in that agent's frontmatter or `config.json` — skills, MCP servers, subagents, extensions, plugins, model, thinking level, and tool policy.
When someone says "the engineer profile," they mean the `engineer` agent with everything it composes.

Folding profiles into agents removes a layer of indirection.
Instead of a settings map that points at resources that point at an identity, one agent directory holds identity and loadout together, resolves by slug like any other resource, and is what you run:

```bash
outfitter run engineer
outfitter run engineer --harness claude
```

`outfitter list agents` shows every resolvable agent and where each resolves from, including shadowed IDs.
Set `default_agent` in [settings](./settings.md) to choose what plain `outfitter` runs.

## Where the loadout lives

The loadout lives on the agent, not in settings.
Add or change what an agent composes by editing that agent's `agents/<id>/agent.md` frontmatter or `config.json` — see [Agents](./agents.md#loadout-fields) for the field list.
To override just one field from a higher layer (swap the model, add an extension) without redefining the agent, put it in the agent's `config.json`: JSON files shallow-merge by key across layers.
An `agent.md` resolves whole-resource by ID — the winning layer's `agent.md` replaces lower ones rather than field-merging — so a partial `agent.md` would discard the base identity.

Settings ([settings.md](./settings.md)) is left with just resolution and launch concerns — `default_agent`, `default_harness`, `sources`, and state policy — not resource selection.

## Composing from a base

Use `inherits` when one agent is a specialization of another.
The base agent's body and additive loadout compose first; child bodies append, child scalar controls override, and inherited parent-local resources retain their parent ownership.
For example, `platform-engineer` can `inherits: engineer` and add `skills: [nix, kubernetes]`.
Multiple parents are ordered left-to-right, recursively, with diamond ancestors included once.

Use tree-level `system-prompt.md` and `agents.md` for context shared by every agent, and [skills](./skills.md) for reusable procedures.
Selecting an agent as a `subagent` is different from inheritance: it exposes a runtime delegation target and does not merge that delegate's identity into the leader.
See [Agents](./agents.md#inheritance-and-prompt-fragments) for the exact merge and prompt-source rules.

## Migrating from authored profiles

Earlier Outfitter versions defined profiles as authored YAML files (`.outfitter/profiles/`, `profile.yml`, inheritance, `controls`).
That system is removed with no compatibility mode.
See the [migration reference](./migration.md) for the manual mapping from the legacy format to agents and their loadouts.

## Compiled profiles

`outfitter sync` is the compilation boundary between your `.agents` tree and each harness's native
profile surface (issue [#387](https://github.com/ai-outfitter/outfitter/issues/387)).
After fetching sources, sync composes every enabled agent exactly once, fingerprints the composition
(`sha256` over the harness-neutral plan), and writes a registry to `~/.outfitter/profiles/registry.json`.
Runtime selection then consumes precompiled compositions instead of recomposing them:

- **Pi** receives the registry at `<pi home>/outfitter/profiles/registry.json`.
  In a Pi session, `/outfitter profile <slug>` switches the active composition for the next turn of
  the same process and session: the per-turn system prompt is replaced (never appended to), only the
  destination profile's skill summaries and tool allowlist are exposed, its model and thinking level
  are selected, the header updates, and an auditable `outfitter-profile-change` entry records the old
  and new slugs and fingerprints. A failed activation (unknown slug, missing model) leaves the prior
  profile and every selector untouched. Switching shares the process credentials and authority —
  it is posture selection, not a security boundary — and it does not restart Pi or rewrite a live
  projection tree. MCP server activation and profile-scoped hooks are not switched until the Pi MCP
  adapter exposes a profile-aware seam.
- **Claude Code** receives a native agent definition `agents/<slug>.md` per compiled agent, carrying
  the composed identity and supported loadout with the fingerprint in the generated marker, so
  `claude --agent engineer` selects it.
- **Codex** receives `<slug>.config.toml` per compiled agent — a `[profiles.<slug>]` table with the
  model, reasoning effort, and the path of a composed instruction document at
  `outfitter/agents/<slug>.md` — plus a `fingerprint:` comment, so `codex --profile engineer`
  selects it. Codex profiles cannot express per-profile skill, tool, subagent, or MCP enforcement;
  those elements are reported as unsupported rather than dropped silently.

Each harness home records projected fingerprints in `<harness home>/.outfitter/profiles.json`, and
`outfitter profiles --json` compares them against the compiled registry:

```json
{
  "profiles": [
    {
      "agent": "engineer",
      "fingerprint": "sha256:…",
      "pi": { "status": "ready" },
      "claude": { "status": "partial", "unsupported": ["mcp"] },
      "codex": { "status": "partial", "unsupported": ["skills", "tools"] }
    }
  ]
}
```

Projections follow the same ownership rules as `outfitter link`: an unmanaged file at a planned path
is a `conflict` and fails the sync instead of being overwritten, and a replay with unchanged inputs
performs no filesystem mutation. `outfitter link` and `outfitter sync` may manage the same Claude
agent definition; the projections converge because both generate from the same composition.
