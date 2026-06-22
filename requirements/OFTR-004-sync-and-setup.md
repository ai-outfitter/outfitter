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
8. The interactive `setup` command MUST require interactive TTY streams on both stdin and stdout before prompting.
9. The interactive `setup` command MUST synchronize remote profile sources before any setup profile choice prompt.
10. Initial interactive first-run setup MUST NOT ask a separate default-profile choice before welcome onboarding; the welcome role selection determines the generated local default profile.
11. When the interactive `setup` command presents setup profile choices outside the initial welcome handoff, it MUST present discovered profile IDs as default-profile choices and preserve available display labels in the prompt choices.
12. When the interactive `setup` command presents setup profile choices outside the initial welcome handoff, it MUST validate the selected default profile ID before writing it to `settings.yml`.
13. After the interactive `setup` command writes a selected default profile, any newly-created fallback default profile file MUST correspond to the final selected default profile.
14. A setup source profile MAY publish exactly one hidden profile setup skill at `setup/skills/outfitter-profile-setup/SKILL.md` inside that profile folder.
15. `outfitter-profile-setup` MUST be the only profile setup skill id recognized by `setup`; other skill ids under a profile `setup/skills/` folder MUST NOT be exposed by setup.
16. When `setup` copies a starter profile folder locally, it MUST copy that profile's `setup/skills/outfitter-profile-setup/` directory with the profile folder.
17. `setup` MUST expose `outfitter-profile-setup` only to the immediate interactive setup launch and MUST NOT expose it during normal `outfitter run` profile launches or write it into persistent settings/profile controls.
18. Interactive `setup` with a setup source and one effective `outfitter-profile-setup` skill MUST open the configured default profile and instruct the launched agent to ask whether to run the one-time setup for a project or org folder.
19. Non-interactive `setup` MUST NOT launch an agent; when a profile setup skill is available it SHOULD report that the setup skill can be run by rerunning interactive setup.
20. If multiple contributing profile folders expose an effective `outfitter-profile-setup` skill for the setup launch, `setup` MUST fail with a clear ambiguity error rather than selecting one implicitly.
21. Interactive setup-triggered Pi launches MUST open Pi's `/login` flow automatically when no usable user-local Pi `auth.json` or `models.json` state exists.
22. Setup MUST NOT ask for provider/model setup when usable user-local Pi auth/models state already exists.
23. Setup MUST NOT write provider/model choices into published profile controls or persistent setup-skill controls.
24. Rerunning `outfitter setup <repo>` SHOULD re-consume the setup source non-destructively and expose any effective setup skill only for that interactive setup session.
25. When interactive `setup <source>` presents setup profile choices, it MUST limit those choices to profiles from the passed setup source and MUST NOT include default profile sources from pre-existing effective settings.
26. When interactive `setup <source>` presents setup profile choices and the setup source declares an explicit `default_profile` that exists among those source choices, it MUST make that profile the prompt default and first displayed choice; pre-existing user defaults MUST NOT override that source default for the setup-source prompt.
27. Interactive `setup <source>` MUST NOT present a default-profile choice before the setup-source welcome/import explanation.
28. Interactive `setup <source>` MUST explain which setup source is being imported and MUST let the user choose whether to install profiles into user home or the current project before writing setup-source profiles/settings.
29. Interactive `setup <source>` MUST present exactly one setup-source profile/default choice after the import target choice when setup-source profiles are available.
30. When the interactive setup-source import target is user home, setup MUST copy missing source profiles into `~/.outfitter/profiles`, write the selected default profile to `~/.outfitter/settings.yml`, and preserve non-overwrite copy behavior.
31. When the interactive setup-source import target is the current project, setup MUST copy missing source profiles into `<project>/.outfitter/profiles`, write the selected default profile to `<project>/.outfitter/settings.yml`, ensure that project settings expose `./profiles`, and preserve any existing user default profile.

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
6. The `profile create --scope user` command MUST create profiles under `~/.outfitter/profiles/`.
7. The `profile create --scope project` command MUST create profiles under `<cwd>/.outfitter/profiles/`.
8. The `profile create --scope project-local` command MUST create profiles under `<cwd>/.outfitter/local/profiles/` for machine-local overrides.

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
