# OFTR-004: Setup, Sync, and Profile Creation Commands

## Overview

Outfitter provides setup and maintenance commands that launch Pi-native onboarding, synchronize remote profile sources, and generate placeholder profile folders.

## Requirements

### OFTR-004.1: Setup Command

1. Outfitter MUST provide a `setup` command.
2. The `setup` command MUST launch Pi with Outfitter runtime onboarding and MUST NOT run terminal setup prompts.
3. The `setup` command MUST force Pi-native onboarding even when existing Outfitter settings are present.
4. The `setup <source>` command MUST preserve the provided source and hand it to Pi-native onboarding.
5. Setup writes MUST happen from the Pi-native `/outfitter` flow after Pi starts.

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
10. `~/.outfitter/settings.yml` MUST be the source of truth for private GitHub profile catalog enablement, using `enterprise.private_profile_catalogs: true`.
11. If `enterprise.private_profile_catalogs` is already true in `~/.outfitter/settings.yml`, setup and sync MUST NOT show private-catalog enterprise information or prompts.
12. If setup or sync detects a confirmed-private GitHub catalog while the home setting is not enabled, interactive flows SHOULD ask whether to enable it and MUST include this prompt text:

    ```text
    Private GitHub profile catalog detected: OWNER/REPO.

    Private profile catalog support is covered by the Outfitter Enterprise license.
    Review code/enterprise/LICENSE or your enterprise agreement before enabling.

    Enable private profile catalogs in ~/.outfitter/settings.yml? [y/N]
    ```

13. If the user accepts, setup or sync MUST write `enterprise.private_profile_catalogs: true` to `~/.outfitter/settings.yml` and show:

    ```text
    info: Enabled private profile catalogs in ~/.outfitter/settings.yml.
    ```

14. If the user declines, setup or sync MUST skip that private catalog without changing settings and show:

    ```text
    info: Private profile catalog setup was skipped for OWNER/REPO; no settings were changed.
    ```

15. Non-interactive setup and sync SHOULD skip confirmed-private GitHub catalogs without warning, error, or blocking public/unknown sources, and SHOULD show:

    ```text
    info: Private GitHub profile catalog detected: OWNER/REPO. Enable enterprise.private_profile_catalogs in ~/.outfitter/settings.yml after reviewing code/enterprise/LICENSE or your enterprise agreement.
    ```

16. GitHub privacy detection MUST only treat an HTTP 200 GitHub API response with JSON `private: true` as private. Public responses, unknown responses, HTTP 403/404, network failures, malformed responses, and non-GitHub sources MUST NOT warn, error, or block.
17. Private catalog enablement MUST remain informational commercial governance and MUST NOT collect, echo, persist, synthesize, or validate provider credentials.

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
