# OFTR-002: Settings Discovery and Validation

> **Amendment (2026-07-17, RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165)):**
> settings moved from `.outfitter/` to the `.agents` tree and dropped resource-selection keys.
> `default_profile` → `default_agent` (an agent slug); the former `default_agent` (harness) →
> `default_harness`; `profile_sources` → `sources`; `state_persistence` moved into settings; the
> nested `local/` directory became a flat `settings.local.yml`; the `profile_export` key and the
> `profiles:` map were removed. Section IDs are preserved so pinned-test traceability holds. The
> target design lives in [docs/documentation/settings.md](../documentation/settings.md).

> **Amendment (2026-09-02):** `workflows` now selects enabled workflow entry points. Unlike other
> list settings, every loaded settings file contributes to an ordered-set union. This does not make
> settings an agent-loadout selection surface; it controls which workflow roots commands expose.

> **Amendment (2026-09-02, issue [#347](https://github.com/ai-outfitter/outfitter/issues/347)):**
> `agent_defaults` adds a generalized additive loadout composition surface (section OFTR-002.10).
> This deliberately scopes settings to the only additive loadout fields; it does not make settings
> an agent identity or scalar-override surface, and it stays backend-neutral.

## Overview

Outfitter settings are the merged result of user, user-local, project, and project-local
`.agents/settings.yml` (and sibling `.agents/settings.local.yml`) files.
The internal Settings object is the single source of resolved configuration for commands. Settings
carry no agent loadout selections — an agent's loadout lives on the agent, not in settings. They MAY
enable workflow roots as command entry points.

## Requirements

### OFTR-002.1: Settings Locations

1. Outfitter MUST support a user settings file at `~/.agents/settings.yml`.
2. Outfitter MUST support a user-local settings file at `~/.agents/settings.local.yml`.
3. Outfitter MUST support a project settings file at `<project>/.agents/settings.yml`.
4. Outfitter MUST support a project-local settings file at `<project>/.agents/settings.local.yml`.
5. `settings.local.yml` MUST be a flat file beside `settings.yml`; there is no nested local directory.
6. Outfitter MUST collectively refer to discovered settings files as `settings.yml` in user-facing documentation when discussing the merged settings concept.

### OFTR-002.2: Settings Precedence

1. Project-local settings MUST take precedence over project settings.
2. Project settings MUST take precedence over user-local settings.
3. User-local settings MUST take precedence over user settings.
4. User settings MUST take precedence over cached remote settings, which take precedence over built-in defaults.
5. Outfitter MUST expose the merged result as a conceptual internal `Settings` object.
6. The Settings loader SHOULD be designed so future settings sources can be added without changing command implementations.

### OFTR-002.3: Settings Schema

1. Outfitter MUST provide a JSON Schema for `settings.yml`.
2. Outfitter MUST validate every discovered `settings.yml` file against the settings JSON Schema before merging it.
3. Validation diagnostics MUST identify the file that failed validation.
4. Validation diagnostics SHOULD identify the failing setting path when the validator provides that information.

### OFTR-002.4: Default Agent and Harness

1. `settings.yml` MAY declare a `default_agent` naming the agent slug that plain `outfitter` runs when no agent is selected.
2. `settings.yml` MAY declare a `default_harness` of `pi`, `claude`, or `codex` selecting the harness launched when `--harness` is omitted.
3. `outfitter run` MUST use the resolved `default_agent` when no agent is selected on the command line.
4. Outfitter MUST report an actionable error when no selected agent and no `default_agent` are available.
5. `settings.yml` MAY declare an `isolation` of `inherit` or `isolated`, selecting whether a run stands on the harness configuration already present on the machine. Outfitter MUST default to `inherit`, MUST let `--isolated` override it for a single run, and MUST honor the declared value only from home-scope settings.

### OFTR-002.5: Sources in Settings

1. `settings.yml` MAY contain a `sources` array of `.agents` payload sources.
2. Each `sources` entry MUST specify either a local `path`, a remote `uri`, or a `github` shorthand.
3. A local-only `path` source MUST resolve relative to the settings file containing it when the path is relative.
4. A local-only `path` source MUST point to a directory containing a `.agents` payload.
5. A `uri` or `github` source MUST be syncable by `outfitter sync`.
6. A `uri` or `github` source MAY specify `ref` to select a branch, tag, or commit.
7. A `uri` or `github` source MAY specify `path` to load the payload from a repository subdirectory.

### OFTR-002.6: Remote Settings Sources

1. `settings.yml` MAY contain a `remote_settings` array.
2. Each `remote_settings` entry MUST specify either a remote `uri` or a `github` shorthand.
3. Each `remote_settings` entry MUST specify `path` to a settings-style YAML file inside the remote repository.
4. A `remote_settings` entry MAY specify `ref` to select a branch, tag, or commit.
5. Outfitter MUST load cached remote settings files from their repository subpaths when resolving settings.
6. Local discovered settings MUST take precedence over remote settings when both define the same setting.

### OFTR-002.7: Cache Directory Setting

1. `settings.yml` MAY contain a `cache_directory` path.
2. Relative `cache_directory` values MUST resolve relative to the settings file containing them.
3. When `cache_directory` is not configured, Outfitter MUST use `~/.agents/cache` as the default cache directory.
4. Agent adapters MUST receive the resolved cache directory when composing a run so persistent projection links use the configured cache location.

### OFTR-002.8: State Persistence in Settings

1. `settings.yml` MAY contain a `state_persistence` object mapping adapter-declared state paths to a persistence strategy.
2. Outfitter MUST validate `state_persistence` strategy values as one of `symlink`, `discard`, `warn`, `error`, or `prompt`.
3. When `state_persistence` is omitted from all settings scopes, Outfitter MUST fall back to adapter default strategies.
4. Higher-precedence settings files MUST override lower-precedence `state_persistence` entries per state path.

### OFTR-002.9: Workflow Enablement

1. Every loaded `settings.yml` and `settings.local.yml`, including configured `remote_settings`, MAY declare a unique `workflows` array of workflow root slugs.
2. Outfitter MUST reject duplicate workflow slugs within one settings file.
3. Outfitter MUST merge workflow enablement as an ordered-set union across remote, user, user-local, project, and project-local settings, collapsing cross-file duplicates to their first occurrence.
4. Missing and empty `workflows` arrays MUST enable zero roots.
5. A configured `source` MUST contribute workflow definitions but MUST NOT cause settings from that source payload to be loaded.
6. `outfitter list workflows` MUST expose enabled workflow roots only in text and JSON output.
7. `outfitter validate` MUST validate each enabled root and its reachable workflow, agent, and resource closure, and MUST NOT report workflow-specific findings for disabled workflows.
8. `outfitter dump --workflow <slug>` MUST reject a disabled root with guidance to add it to `workflows`.
9. A nested workflow dependency MUST be available to an enabled root's validation and dump closure without being separately listed, but MUST remain unavailable as a direct dump root unless separately enabled.
10. Enabled workflow definitions MUST follow normal resource precedence, including project definitions overriding user or source definitions of the same slug.

### OFTR-002.10: Agent Defaults

1. `settings.yml` MAY declare an optional `agent_defaults` object of additive loadout entries composed into every agent.
2. `agent_defaults` MUST support only the additive loadout fields `extensions`, `skills`, `mcp`, `plugins`, `subagents`, and `append_system_prompt`; Outfitter MUST reject unknown `agent_defaults` keys and MUST NOT add scalar-override fields such as `model`, `thinking`, or `tools`.
3. Outfitter MUST compose `agent_defaults` into every agent ahead of that agent's own loadout, using the same deterministic parent-first ordering and stable de-duplication semantics as inherited agent loadouts, so an agent's own entries never duplicate a default and the settings layer wins first-encounter conflicts like a root-most ancestor.
4. `agent_defaults` selections MUST resolve catalog-wide across layers; they MUST NOT resolve through any agent's local namespace.
5. Every loaded settings file, including configured `remote_settings`, MAY declare `agent_defaults`, and Outfitter MUST merge fields across the stack as ordered-set unions collapsing duplicates to their first occurrence, lowest-precedence entries first.
6. `outfitter run`, `outfitter dump`, and `outfitter validate` MUST operate on the same effective composition of `agent_defaults` and agent loadouts.
7. Unresolved `agent_defaults` references MUST surface through composition warnings and `outfitter validate` findings, naming the settings layer rather than an agent.
8. `outfitter dump` MUST record settings-layer provenance for composed defaults and MUST carry the merged `agent_defaults` into the dumped tree so the dump remains self-contained.
9. Harness support rules MUST remain unchanged: `agent_defaults` entries ride the same loadout projection as agent-declared entries, so a harness that cannot carry an additive element reports it through existing unsupported-element diagnostics, not a settings-specific error.
10. `agent_defaults` MUST remain backend-neutral: Outfitter MUST NOT introduce backend-specific keys, sink endpoints, credentials, retention policy, or workload-identity behavior.
11. Settings without `agent_defaults` MUST compose, validate, run, and dump exactly as before this section existed.

### OFTR-002.11: Native Harness Defaults

1. `settings.yml` MAY declare `harness_defaults` keyed only by `pi`, `claude`, and `codex`; unknown harness names MUST be rejected.
2. Each harness value MUST accept arbitrary native setting keys whose values are JSON-compatible scalars, arrays, or objects.
3. Outfitter MUST deep-merge objects across the settings stack with higher-precedence leaves replacing lower-precedence leaves; arrays and scalars MUST replace rather than union.
4. `outfitter run` MUST apply the selected harness's effective defaults through its native configuration surface. Pi agent configuration overlays MUST remain higher precedence than shared defaults.
5. Codex values that cannot be represented as TOML MUST be skipped with a warning.
6. `outfitter link` MUST manage defaults as individual native setting values and MUST NOT replace, adopt, or delete unrelated or unmanaged native settings.
7. `outfitter dump` MUST carry effective `harness_defaults` into the dumped tree.
8. Settings without `harness_defaults` MUST run, link, and dump exactly as before this section existed.
