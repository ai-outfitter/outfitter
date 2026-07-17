# OFTR-003: Agents and Resolution

> **Amendment (2026-07-17, RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165)):**
> profiles fold into agents. Authored `profile.yml` files, `inherits` inheritance, `template`
> profiles, and `profile_export` are removed; an agent is `agents/<id>/agent.md` frontmatter plus an
> optional `config.json`, resolved by slug across `.agents` layers with merge-by-ID. Section IDs are
> preserved for pinned-test traceability. Target design: [docs/documentation/agents.md](../documentation/agents.md)
> and [docs/architecture/README.md](../architecture/README.md).

## Overview

An agent is the protocol's identity resource and the thing Outfitter runs. Outfitter resolves agents
and other resources from layered `.agents` trees into one immutable effective resource set that every
command shares.

## Requirements

### OFTR-003.1: Agent Resource Layout

1. An agent MUST be represented by a directory `agents/<id>/` containing a required `agent.md` file.
2. `agent.md` MUST begin with a `---` YAML frontmatter block declaring at least `name`.
3. An agent directory MAY contain an optional `config.json` carrying structured loadout overrides.
4. Outfitter MUST provide a JSON Schema for `agent.md` frontmatter and validate every loaded agent against it.
5. Skills, knowledge, and commands are separate protocol resources under `skills/<id>/SKILL.md`, `knowledge/`, and `commands/` respectively.

### OFTR-003.2: Agent Identity

1. Agent IDs MUST be filesystem-safe slugs matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters.
2. The agent's frontmatter `name` MUST match its directory ID; a mismatch MUST be a validation error.
3. Agents MAY include a `description` used by discovery surfaces.

### OFTR-003.3: Layer Precedence

1. Outfitter MUST resolve resources from layered `.agents` trees ordered highest precedence first: workspace `<project>/.agents`, then global `~/.agents`, then configured `sources` in order.
2. Only layers whose payload root exists on disk are included.
3. A local `path` source's payload root is the directory itself; a remote source's root is its synced cache directory plus any configured subpath.

### OFTR-003.4: Merge by ID

1. Resources MUST merge by ID across layers: the highest-precedence definition of a slug wins and replaces lower ones. Markdown resources are not partially merged.
2. Per-agent `config.json` MUST shallow-merge by key over the `agent.md` frontmatter loadout for the same agent directory.
3. There is no profile inheritance; shared context lives in tree-level `system-prompt.md`/`agents.md`.

### OFTR-003.5: Effective Resource Set

1. Outfitter MUST produce one immutable effective resource set per invocation mapping every slug to its winning definition.
2. Lower-precedence definitions that a winner shadows MUST be retained for diagnostics.
3. `list`, `validate`, `run`, and `dump` MUST consume the same effective resource set produced by a single shared resolver.

### OFTR-003.6: Loadout

1. An agent's frontmatter/`config.json` MAY declare a loadout: `skills`, `subagents`, `mcp`, `extensions`, `plugins`, `model`, `thinking`, and `tools`.
2. Loadout list entries MUST be slugs resolved against the effective resource set across layers; nothing is copied into the agent.
3. Settings MUST NOT carry loadout selections.

### OFTR-003.7: Resolution Validation

1. Outfitter MUST report an error when an agent's loadout references a `skills` or `subagents` slug that does not resolve.
2. Outfitter MUST report a warning when a resource shadows a lower-precedence definition of the same slug.
3. `outfitter validate --strict` MUST treat warnings as failures.

### OFTR-003.8: Listing Resources

1. `outfitter list` MUST list resolvable resources by kind from the effective resource set.
2. `outfitter list <kind>` MUST restrict output to one kind of `agents`, `skills`, `knowledge`, or `commands` and MUST reject unknown kinds.
3. Listed resources MUST report the winning layer for each slug deterministically.
