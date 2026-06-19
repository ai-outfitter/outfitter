# OFTR-004: Setup, Sync, and Profile Creation Commands

## Overview

Outfitter provides setup and maintenance commands that create initial configuration, synchronize remote profile sources, and generate placeholder profile folders.

## Requirements

### OFTR-004.1: Setup Command

1. Outfitter MUST provide a `setup` command.
2. The `setup` command MUST create `~/.outfitter/settings.yml` when it does not exist.
3. The `setup` command MUST create a default user profile when no user default profile exists.
4. The `setup` command MUST validate discovered settings files.
5. The `setup` command MUST run sync behavior for URI-based profile sources.
6. The `setup` command SHOULD avoid overwriting existing user files unless a future explicit force option authorizes replacement.
7. When provided a setup source URI, the `setup` command MUST use that source repository's Outfitter `settings.yml` and profiles as the initial user setup starting point.
8. The interactive `setup` command MUST require interactive TTY streams on both stdin and stdout before prompting.
9. The interactive `setup` command MUST synchronize remote profile sources before any setup profile choice prompt.
10. Initial interactive first-run setup MUST NOT ask a separate default-profile choice before welcome onboarding; the welcome role selection determines the generated local default profile.
11. When the interactive `setup` command presents setup profile choices outside the initial welcome handoff, it MUST present discovered profile IDs as default-profile choices and preserve available display labels in the prompt choices.
12. When the interactive `setup` command presents setup profile choices outside the initial welcome handoff, it MUST validate the selected default profile ID before writing it to `settings.yml`.
13. After the interactive `setup` command writes a selected default profile, any newly-created fallback default profile file MUST correspond to the final selected default profile.

### OFTR-004.2: Sync Command

1. Outfitter MUST provide a `sync` command.
2. The `sync` command MUST read and validate settings before synchronizing sources.
3. The `sync` command MUST fetch or update remote settings sources and URI-based profile sources.
4. The `sync` command MUST store plain URI-based profile sources without `ref` or repository subpaths under `~/.outfitter/cache/profiles/<encoded-uri>/`, and MUST store URI or GitHub sources with `ref` or repository subpaths under `~/.outfitter/cache/repos/<encoded-uri-and-ref>/`.
5. The encoded URI cache path MUST support non-GitHub URIs.
6. The `sync` command MUST validate profiles loaded from synchronized sources.
7. The `sync` command SHOULD report whether each source was updated, unchanged, skipped, or failed.
8. The first version of `sync` MUST NOT require lockfile-based profile source reproducibility.
9. The `sync` command MUST redact credentials embedded in source URIs from user-facing output.

### OFTR-004.3: Create Profile Command

1. Outfitter MUST provide a `profile create` command.
2. The `profile create` command MUST require a destination scope or destination path.
3. The `profile create` command MUST require a profile name.
4. The `profile create` command MUST create a placeholder profile folder with a valid `profile.yml` file.
5. The `profile create` command SHOULD create conventional subfolders for common profile resources.

### OFTR-004.4: Command Object Implementation

1. All CLI command entry points MUST execute command objects rather than duplicate implementation logic in parser callbacks.
2. Command objects MUST accept typed input objects rather than reading directly from `process.argv`.
3. Command objects SHOULD receive filesystem, settings, profile, and process dependencies through constructors or equivalent dependency injection.
4. The `profile create` parser entry point MUST execute the profile-creation command object.

### OFTR-004.5: List Profiles Command

1. Outfitter MUST provide a `profile list` command.
2. The `profile list` command MUST read and validate settings before listing profiles.
3. The `profile list` command MUST list unique profile IDs from configured local and cached remote profile sources.
4. When multiple configured sources define the same profile ID, the listed profile metadata MUST come from the highest-precedence loaded definition.
