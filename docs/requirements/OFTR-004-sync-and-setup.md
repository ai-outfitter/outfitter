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
7. When provided a setup source URI, the `setup` command MUST use that source repository's Outfitter `settings.yml` and profiles as the initial setup starting point for the selected import target.
8. When provided a local setup source path, the `setup` command MUST discover profiles and settings from the live local source `.outfitter` rather than from a setup-source cache.
9. The interactive `setup` command MUST require interactive TTY streams on both stdin and stdout before prompting.
10. The interactive `setup` command MUST synchronize remote profile sources before any setup profile choice prompt.
11. Initial interactive first-run setup MUST NOT ask a separate default-profile choice before welcome onboarding; the welcome role selection determines the generated local default profile.
12. Interactive setup MUST render the shared Outfitter branded ASCII welcome before setup prompts.
13. When the interactive `setup` command presents setup profile choices outside the initial welcome handoff, it MUST present discovered profile IDs as default-profile choices and preserve available display labels and descriptions in the prompt choices.
14. Interactive setup profile choices MUST come from loaded profile sources and MUST NOT hardcode profile-repository IDs, labels, or descriptions in setup code.
15. When the interactive `setup` command presents setup profile choices outside the initial welcome handoff, it MUST validate the selected default profile ID before writing it to `settings.yml`.
16. After the interactive `setup` command writes a selected default profile, any newly-created fallback default profile file MUST correspond to the final selected default profile.
17. When interactive `setup <source>` presents setup profile choices, it MUST limit those choices to profiles from the passed setup source and MUST NOT include default profile sources from pre-existing effective settings.
18. When interactive `setup <source>` presents setup profile choices and the setup source declares an explicit `default_profile` that exists among those source choices, it MUST make that profile the prompt default and first displayed choice; pre-existing user defaults MUST NOT override that source default for the setup-source prompt.
19. When interactive `setup <source>` presents setup profile choices and no source `default_profile` resolves, it SHOULD use the first loaded source profile as the prompt default.
20. Interactive `setup <source>` MUST NOT present a default-profile choice before the setup-source welcome/import explanation.
21. Interactive `setup <source>` MUST explain which setup source is being imported and MUST let the user choose whether to install profiles into user home or the current project before writing setup-source profiles/settings.
22. Interactive `setup <source>` MUST present exactly one setup-source profile/default choice after the import target choice when setup-source profiles are available.
23. When the interactive setup-source import target is user home, setup MUST copy missing source profiles into `~/.outfitter/profiles`, write the selected default profile to `~/.outfitter/settings.yml`, and preserve non-overwrite copy behavior.
24. When the interactive setup-source import target is the current project, setup MUST copy missing source profiles into `<project>/.outfitter/profiles`, write the selected default profile to `<project>/.outfitter/settings.yml`, ensure that project settings expose `./profiles`, and preserve any existing user default profile.
25. Setup-source copy mode MUST preserve flat profile files and shared setup resources required by those profiles.
26. After interactive `setup <source>` imports the selected default profile, setup MUST offer to start Outfitter with that selected profile.
27. When the user declines the post-import start offer, setup MUST exit without launching and show both `outfitter` for starting the configured default profile and `outfitter --profile <selected-profile>` for starting it explicitly.
28. Non-interactive `setup <source>` completion MUST NOT launch Outfitter and MUST show the same default and explicit start command guidance.
29. Interactive `setup <local-path>` MUST keep copy/import snapshot setup as the default behavior.
30. Interactive `setup <local-path>` SHOULD offer an explicit symlink mode when the local source contains a `.outfitter` directory.
31. When symlink mode is available, setup MUST explain that copy/import is an isolated snapshot while symlink mode links the target `.outfitter` to the local source `.outfitter` so shared-profile edits apply immediately during development.
32. Symlink setup MUST NOT replace a non-empty target `.outfitter` directory without explicit user confirmation.
33. Symlink setup MUST symlink the target `.outfitter` to the local source `.outfitter` and MUST NOT copy source files, create fallback profile directories, or mutate source settings unless a future explicit option authorizes source mutation.

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
