# BRIDL-REQ-002: Settings Discovery and Validation

## Overview

Bridl settings are the merged result of user, project, and project-local `.bridl/settings.yml` files.
The internal Settings object is the single source of resolved configuration for commands.

## Requirements

### BRIDL-REQ-002.1: Settings Locations

1. Bridl MUST support a user settings file at `~/.bridl/settings.yml`.
2. Bridl MUST support a project settings file at `<project>/.bridl/settings.yml`.
3. Bridl MUST support a project-local settings file at `<project>/.bridl/local/settings.yml`.
4. Bridl MUST collectively refer to discovered settings files as `settings.yml` in user-facing documentation when discussing the merged settings concept.

### BRIDL-REQ-002.2: Settings Precedence

1. Project-local settings MUST take precedence over project settings.
2. Project settings MUST take precedence over user settings.
3. User settings MUST take precedence over built-in defaults.
4. Bridl MUST expose the merged result as a conceptual internal `Settings` object.
5. The Settings loader SHOULD be designed so future settings sources can be added without changing command implementations.

### BRIDL-REQ-002.3: Settings Schema

1. Bridl MUST provide a JSON Schema for `settings.yml`.
2. Bridl MUST validate every discovered `settings.yml` file against the settings JSON Schema before merging it.
3. Validation diagnostics MUST identify the file that failed validation.
4. Validation diagnostics SHOULD identify the failing setting path when the validator provides that information.

### BRIDL-REQ-002.4: Default Profile

1. The user settings file `~/.bridl/settings.yml` MUST declare a default profile after `bridl setup` completes.
2. `bridl run` MUST use the resolved default profile when no profile is selected with `-p` or `--profile`.
3. Bridl MUST report an actionable error when no selected profile and no default profile are available.

### BRIDL-REQ-002.5: Profile Sources in Settings

1. `settings.yml` MAY contain a `profile_sources` array.
2. Each `profile_sources` entry MUST specify either a local `path`, a remote `uri`, or a `github` shorthand.
3. A local-only `path` profile source MUST resolve relative to the settings file containing it when the path is relative.
4. A local-only `path` profile source MUST point to a folder containing profile folders rather than to one specific profile folder.
5. A `uri` or `github` profile source MUST be syncable by `bridl sync`.
6. A `uri` or `github` profile source MAY specify `ref` to select a branch, tag, or commit.
7. A `uri` or `github` profile source MAY specify `path` to load profiles from a repository subdirectory.
8. A profile source MAY specify `only` to allow only named profiles from that source.
9. A profile source MAY specify `except` to exclude named profiles from that source.
10. If neither `only` nor `except` is specified, Bridl MUST load all profiles from the source.

### BRIDL-REQ-002.6: Remote Settings Sources

1. `settings.yml` MAY contain a `remote_settings` array.
2. Each `remote_settings` entry MUST specify either a remote `uri` or a `github` shorthand.
3. Each `remote_settings` entry MUST specify `path` to a settings-style YAML file inside the remote repository.
4. A `remote_settings` entry MAY specify `ref` to select a branch, tag, or commit.
5. Bridl MUST load cached remote settings files from their repository subpaths when resolving settings.
6. Local discovered settings MUST take precedence over remote settings when both define the same setting.

### BRIDL-REQ-002.7: Cache Directory Setting

1. `settings.yml` MAY contain a `cache_directory` path.
2. Relative `cache_directory` values MUST resolve relative to the settings file containing them.
3. When `cache_directory` is not configured, Bridl MUST use `~/.bridl/cache` as the default cache directory.
4. Agent adapters MUST receive the resolved cache directory when assembling a tack so persistent tack links use the configured cache location.
