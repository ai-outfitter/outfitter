# OFTR-003: Agents and Resolution

> **Amendment (2026-07-17, RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165)):** Profiles fold into agents.
> Authored `profile.yml` files, profile-era inheritance, `template` profiles, and `profile_export` are removed; agent inheritance is declared by `inherits` in `agents/<id>/agent.md` frontmatter.
> An agent may also have an optional `config.json` and resolves by slug across `.agents` layers with merge-by-ID.
> Section IDs are preserved for pinned-test traceability.
> Target design: [docs/documentation/agents.md](../documentation/agents.md) and [docs/architecture/README.md](../architecture/README.md).

> **Amendment (2026-08-19, issue [#315](https://github.com/ai-outfitter/outfitter/issues/315)):** Validation now diagnoses Pi agents that select MCP servers without the MCP adapter extension, preventing a healthy-looking launch with no projected MCP tools.

## Overview

An agent is the protocol's identity resource and the thing Outfitter runs.
Outfitter resolves agents and other resources from layered `.agents` trees into one immutable effective resource set that every command shares.

## Requirements

### OFTR-003.1: Agent Resource Layout

1. An agent MUST be represented by a directory `agents/<id>/` containing a required `agent.md` file.
2. `agent.md` MUST begin with a `---` YAML frontmatter block declaring at least `name`.
3. An agent directory MAY contain an optional `config.json` carrying structured loadout overrides.
4. Outfitter MUST provide a JSON Schema for `agent.md` frontmatter and validate every loaded agent against it.
5. A skill MAY be catalog-wide at `skills/<id>/SKILL.md` or private to one agent at `agents/<agent-id>/skills/<id>/SKILL.md`; knowledge and commands remain separate protocol resources under `knowledge/` and `commands/`.
6. `agents/<agent-id>/hooks/<id>/` is reserved for a future portable hook entity and MUST NOT be interpreted as a skill.

### OFTR-003.2: Agent Identity

1. Agent IDs MUST be filesystem-safe slugs matching `^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$`, at most 64 characters. Dots MAY group profiles by namespace convention (for example, `environment.agent-operator-pod` or `environment.sample`), while plain hyphenated slugs remain valid. A dot has naming significance only: it MUST NOT imply hierarchy, wildcard matching, or inheritance.
2. The agent's frontmatter `name` MUST match its directory ID; a mismatch MUST be a validation error.
3. Agents MAY include a `description` used by discovery surfaces.

### OFTR-003.3: Layer Precedence

1. Outfitter MUST resolve resources from layered `.agents` trees ordered highest precedence first: workspace `<project>/.agents`, then global `~/.agents`, then configured `sources` in order.
2. Only layers whose payload root exists on disk are included.
3. A local `path` source's payload root is the directory itself; a remote source's root is its synced cache directory plus any configured subpath.

### OFTR-003.4: Merge by ID

1. Resources MUST merge by ID across layers: the highest-precedence definition of a slug wins and replaces lower ones.
   Markdown resources are not partially merged.
2. Per-agent `config.json` MUST shallow-merge by key over the `agent.md` frontmatter loadout for the same agent directory.
3. Legacy profile inheritance MUST NOT be restored; agent inheritance follows OFTR-003.9 and shared context lives in tree-level `system-prompt.md`/`agents.md`.
4. Agent-local resources MUST merge by owner and ID across layers before catalog-wide fallback is considered.
5. An agent-local skill MAY shadow a catalog-wide skill for its owner without being reported as a catalog collision.

### OFTR-003.5: Effective Resource Set

1. Outfitter MUST produce one immutable effective resource set per invocation mapping every slug to its winning definition.
2. Lower-precedence definitions that a winner shadows MUST be retained for diagnostics.
3. `list`, `validate`, `run`, and `dump` MUST consume the same effective resource set produced by a single shared resolver.
4. The effective resource set MUST retain agent ownership for local resources so equal local IDs under different agents remain distinct.

### OFTR-003.6: Loadout

1. An agent's frontmatter/`config.json` MAY declare a loadout: `skills`, `subagents`, `mcp`, `extensions`, `plugins`, `model`, `thinking`, and `tools`.
2. A skill loadout entry MUST resolve first against the owning agent's local skill namespace across layers, then against catalog-wide skills across layers.
3. An agent-local skill MUST be invisible to other agents unless they define their own local skill of that ID or a catalog-wide fallback exists.
4. Settings MUST NOT carry loadout selections.

### OFTR-003.7: Resolution Validation

1. Outfitter MUST report an error when an agent's loadout references a `skills` or `subagents` slug that does not resolve.
2. Outfitter MUST report a warning when a resource shadows a lower-precedence definition of the same slug.
3. `outfitter validate --strict` MUST treat warnings as failures.
4. Validation MUST parse every discovered agent-local skill and report malformed definitions, name/directory mismatches, and local resources without a resolvable owning agent.
5. When targeting Pi, `outfitter validate` MUST warn for every composed agent that selects one or more MCP servers without the `npm:pi-mcp-adapter` extension; `--strict` MUST make the warning fatal. Agents with no MCP selection and validation targeting another harness MUST remain unaffected.

### OFTR-003.8: Listing Resources

1. `outfitter list` MUST list resolvable resources by kind from the effective resource set.
2. `outfitter list <kind>` MUST restrict output to one kind of `agents`, `skills`, `knowledge`, or `commands` and MUST reject unknown kinds.
3. Listed resources MUST report the winning layer for each slug deterministically.
4. `outfitter list skills --agent <id>` MUST show the agent's local-first effective skill view and distinguish agent-local winners.

### OFTR-003.9: Agent Inheritance Graph

1. `agent.md` frontmatter MAY declare `inherits` as one parent slug or an ordered non-empty list of parent slugs.
2. Outfitter MUST resolve every inherited parent through the same effective layered resource set used for the selected child.
3. Inheritance traversal MUST be recursive, parent-first, and left-to-right for multiple parents.
4. A diamond inheritance graph MUST compose each ancestor once in deterministic first-encounter order.
5. Missing parents, self-inheritance, and direct or indirect cycles MUST fail validation and composition with the relevant chain.
6. Inheritance MUST extend the `.agents` agent model and MUST NOT reintroduce `.outfitter/profiles`, `profile.yml`, profile templates, or legacy profile readers.

### OFTR-003.10: Inherited Merge Policy

1. Agent Markdown bodies MUST compose ancestor-first and selected-child-last.
2. `skills`, `subagents`, `mcp`, `extensions`, `plugins`, and `append_system_prompt` MUST use stable parent-first de-duplication.
3. `system_prompt`, `prompt_template`, `model`, `thinking`, `label`, and `description` MUST use the nearest child declaration.
4. `tools.allow` and `tools.deny` MUST union stably; denied tools MUST win when projected.
5. Outfitter MUST retain declaring-agent provenance for inherited selections so parent-local skills and configuration resolve against the parent that declared them.
6. Inheritance MUST NOT support subtraction syntax or arbitrary per-field merge operators.

### OFTR-003.11: Prompt Source Controls

1. `system_prompt`, `append_system_prompt`, and `prompt_template` MUST accept only explicit prompt source objects using exactly one of `file` or `repo_file`.
2. `file` prompt sources MUST resolve relative to the `.agents` layer that owns the declaring agent and MUST fail on missing files, directories, path traversal, absolute paths, unsafe symlink targets, and reads outside that layer.
3. `repo_file` prompt sources MUST resolve relative to the active project root, MUST remain contained after symlink resolution, and MUST be attributed as untrusted repository content.
4. Missing optional `repo_file` prompt fragments SHOULD produce observable composition warnings instead of making reusable catalog agents fail across repositories.
5. Prompt fragments MUST retain source kind, path or reference, declaring agent, owning layer, content, order, and trust provenance in the composition plan.
6. Named prompt slug shorthand MUST NOT be accepted until its namespace, layer semantics, protocol compatibility, and dump behavior are specified in these requirements.
