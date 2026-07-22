# Agents

An agent is the protocol's identity resource — and, in Outfitter, the thing you run. A directory under `agents/<id>/` holds an `agent.md` definition and an optional `config.json`. Together they carry both _who the agent is_ and _what it runs with_: its skills, MCP servers, subagents, extensions, plugins, model, thinking level, and tool policy. That whole bundle — identity plus loadout — is what earlier drafts called a "profile." There is no separate profile resource; **an agent is the profile**. See [Profiles](./profiles.md).

```text
.agents/
  agents/
    engineer/
      agent.md
      config.json   # optional
      skills/       # capabilities private to engineer
        release-debug/SKILL.md
      hooks/        # reserved for a future portable hook entity
    code-reviewer/
      agent.md
```

## agent.md

`agent.md` describes the identity in markdown — who the agent is, its policy and posture, how it approaches work — and declares its loadout in frontmatter:

```markdown
---
name: engineer
description: Implements features and fixes with a bias toward small, verifiable changes.
skills: [wiki, research]
subagents: [code-reviewer]
extensions: [outfitter-mode]
plugins: [git-tools]
mcp: [github]
model: gpt-5.2
thinking: high
tools:
  allow: [read, edit, bash]
---

# Engineer

You implement changes directly, keep diffs small, and verify before claiming done...
```

Keep the prose focused on durable identity and behavior. Per-capability procedures belong in [skills](./skills.md); the frontmatter only _selects_ resources by slug — it never copies their content.

### Loadout fields

| Field        | Selects                                                                      |
| ------------ | ---------------------------------------------------------------------------- |
| `skills`     | [Skill](./skills.md) slugs made available to the run.                        |
| `mcp`        | MCP servers from the tree's `mcp.json` to enable.                            |
| `subagents`  | Agent slugs projected as harness delegates. See [Subagents](./subagents.md). |
| `extensions` | Pi extensions to load. First-class, per the adapter.                         |
| `plugins`    | Pi plugins to load. First-class, per the adapter.                            |
| `model`      | Provider/model from `models.json`.                                           |
| `thinking`   | Thinking/effort level.                                                       |
| `tools`      | Allowed/denied tool policy for the run.                                      |

Every value is a slug resolved across layers. Skills first check `agents/<agent>/skills/<slug>/` across layer precedence, then fall back to catalog-wide `skills/<slug>/`. This lets an agent own private implementation capabilities without exposing them to every agent in the catalog. See [Skills](./skills.md#agent-local-skills).

`knowledge` and `commands` resolve the same way — an agent may keep private files under `agents/<agent>/knowledge/` and `agents/<agent>/commands/`, local-first over the catalog-wide trees. `subagents` are always catalog-wide (a delegate is a shared agent). `extensions`/`plugins` are harness-native passthroughs with no on-disk namespace, and `model`/`thinking`/`tools` are per-agent already via `config.json` merge — none of these have an `agents/<agent>/` directory.

Two per-agent surfaces are **discovered but not yet projected** (adapter parity is tracked in [#183](https://github.com/ai-outfitter/outfitter/issues/183)): `agents/<agent>/mcp.json` (merges by server id over the tree-root `mcp.json`) and the reserved `agents/<agent>/hooks/` namespace (see [Hooks](./hooks.md)). Both surface a validation warning when present so a selection placed there is never silently dropped.

## config.json

The optional `config.json` carries structured or harness-specific configuration that is awkward in frontmatter, following the protocol's schema for the pinned revision. JSON files merge across layers per the protocol's JSON merge behavior, so a workspace layer can adjust one field of a globally defined agent — swap the model, add an extension — without copying the whole definition.

## Tree-level context

Two files at the tree root complement agent definitions:

- `agents.md` — shared operating context that applies to every run from this tree.
- `system-prompt.md` — the base system prompt an agent's identity layers on top of.

## Running an agent

Select an agent by slug; choose the harness with `--harness`:

```bash
outfitter run engineer
outfitter run engineer --harness claude
```

`default_agent` in [settings](./settings.md) sets what plain `outfitter` runs.

## Resolution

Agents resolve by slug across layers — workspace, global, then remote sources — with merge-by-ID semantics: a workspace `agents/engineer/` overrides a global or remote one. Agent-local skills merge by their owner and slug using the same layer order. `outfitter list agents` shows every resolvable agent and its winning source; `outfitter list skills --agent engineer` shows its effective skill namespace; `outfitter validate` reports broken loadout slugs and shadowed definitions.

## Agents as delegates

The same agent definition can also be selected as a [subagent](./subagents.md) in another agent's `subagents` list — a delegate the run can hand focused work to. A leader agent's loadout is where that delegation is declared.
