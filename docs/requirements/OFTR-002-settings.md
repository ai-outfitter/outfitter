# OFTR-002: Settings Discovery and Validation

> **Amendment (2026-07-17, RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165)):**
> settings moved from `.outfitter/` to the `.agents` tree and dropped resource-selection keys.
> `default_profile` → `default_agent` (an agent slug); the former `default_agent` (harness) →
> `default_harness`; `profile_sources` → `sources`; `state_persistence` moved into settings; the
> nested `local/` directory became a flat `settings.local.yml`; the `profile_export` key and the
> `profiles:` map were removed. Section IDs are preserved so pinned-test traceability holds. The
> target design lives in [docs/documentation/settings.md](../documentation/settings.md).

## Overview

Outfitter settings are the merged result of user, user-local, project, and project-local
`.agents/settings.yml` (and sibling `.agents/settings.local.yml`) files.
The internal Settings object is the single source of resolved configuration for commands. Settings
carry no resource selections — an agent's loadout lives on the agent, not in settings.

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
2. `settings.yml` MAY declare a `default_harness` of `pi` or `claude` selecting the harness launched when `--harness` is omitted.
3. `outfitter run` MUST use the resolved `default_agent` when no agent is selected on the command line.
4. Outfitter MUST report an actionable error when no selected agent and no `default_agent` are available.

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
