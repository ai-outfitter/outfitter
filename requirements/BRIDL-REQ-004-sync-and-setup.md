# BRIDL-REQ-004: Setup, Sync, and Profile Creation Commands

## Overview

Bridl provides setup and maintenance commands that create initial configuration, synchronize remote profile sources, and generate placeholder profile folders.

## Requirements

### BRIDL-REQ-004.1: Setup Command

1. Bridl MUST provide a `setup` command.
2. The `setup` command MUST create `~/.bridl/settings.yml` when it does not exist.
3. The `setup` command MUST create a default user profile when no user default profile exists.
4. The `setup` command MUST validate discovered settings files.
5. The `setup` command MUST run sync behavior for URI-based profile sources.
6. The `setup` command SHOULD avoid overwriting existing user files unless a future explicit force option authorizes replacement.

### BRIDL-REQ-004.2: Sync Command

1. Bridl MUST provide a `sync` command.
2. The `sync` command MUST read and validate settings before synchronizing sources.
3. The `sync` command MUST fetch or update URI-based profile sources.
4. The `sync` command MUST store URI-based profile sources under `~/.bridl/cache/profiles/<encoded-uri>/`.
5. The encoded URI cache path MUST support non-GitHub URIs.
6. The `sync` command MUST validate profiles loaded from synchronized sources.
7. The `sync` command SHOULD report whether each source was updated, unchanged, skipped, or failed.
8. The first version of `sync` MUST NOT require lockfile-based profile source reproducibility.

### BRIDL-REQ-004.3: Create Profile Command

1. Bridl MUST provide a `create_profile` command.
2. The `create_profile` command MUST require a destination scope or destination path.
3. The `create_profile` command MUST require a profile name.
4. The `create_profile` command MUST create a placeholder profile folder with a valid `profile.yml` file.
5. The `create_profile` command SHOULD create conventional subfolders for common profile resources.
6. The command MUST also provide a `create-profile` alias for users who expect kebab-case CLI command names.

### BRIDL-REQ-004.4: Command Object Implementation

1. The `setup`, `sync`, `create_profile`, and `create-profile` command entry points MUST execute the same command object rather than duplicate implementation logic.
2. Command objects MUST accept typed input objects rather than reading directly from `process.argv`.
3. Command objects SHOULD receive filesystem, settings, profile, and process dependencies through constructors or equivalent dependency injection.
