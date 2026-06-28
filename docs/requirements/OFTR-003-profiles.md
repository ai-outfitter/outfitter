# OFTR-003: Profiles and Inheritance

## Overview

Profiles describe reusable agent-CLI loadouts.
Outfitter resolves profile definitions across settings scopes, explicit sources, and inherited profiles; the configured user default profile is selected only when no explicit profile is requested.

## Requirements

### OFTR-003.1: Profile Folder Layout

1. A profile MUST be represented by either a folder with a required `profile.yml` file or a flat YAML file named `<profile-id>.yml` or `<profile-id>.yaml`.
2. Outfitter MUST provide a JSON Schema for profile YAML documents.
3. Outfitter MUST validate every loaded profile YAML document against the profile JSON Schema.
4. A profile folder MAY contain conventional resource folders such as `skills`, `prompts`, `extensions`, and `deepwork/jobs`.
5. A profile folder MAY contain `cli_specific/<cli-name>/` folders for agent-specific resources and overrides.
6. Flat profile files MUST NOT be treated as profile resource folders.
7. Setup-source imports MUST preserve flat profile files as flat files unless the user explicitly invokes a profile-creation command.

### OFTR-003.2: Profile Identity

1. Profile IDs MUST be stable identifiers suitable for commands, logs, cache keys, and documentation.
2. Profile IDs MUST match the regex `^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$`.
3. Outfitter MUST reject profile IDs that cannot be safely referenced from the CLI.
4. When a profile YAML document omits `id`, Outfitter MUST derive the profile ID from the containing folder name or flat filename stem.
5. Outfitter MUST reject discovered profile folder names or flat filename stems that are not filesystem-safe profile IDs before using them as fallback IDs.
6. Outfitter SHOULD support a separate display label if human-readable names need spaces or punctuation.
7. Profiles MAY include a short `description` for interactive prompts and profile discovery surfaces.
8. Interactive setup profile prompts MUST use loaded profile IDs, labels, and descriptions as their display metadata rather than hardcoding profile-repository knowledge in setup code.

### OFTR-003.3: Profile Scope Precedence

1. Project-local profile definitions MUST take precedence over project profile definitions for the same profile name.
2. Project profile definitions MUST take precedence over user profile definitions for the same profile name.
3. User profile definitions MUST take precedence over cached URI profile definitions for the same profile name.
4. Cached URI profile definitions MUST be considered according to resolved source order when multiple URI sources provide the same profile name.

### OFTR-003.4: Profile Inheritance

1. `profile.yml` MAY specify an ordered `inherits` array of profile names.
2. Inherited profiles MUST be treated as lower-precedence sources for the inheriting profile.
3. Outfitter MUST recursively resolve inherited profiles.
4. Outfitter MUST detect inheritance cycles and report them as validation errors.
5. Outfitter MUST preserve inherited profile order when building the profile stack.

### OFTR-003.5: Default Profile Selection

1. Outfitter MUST use the configured `default_profile` only when no explicit profile is selected.
2. When an explicit profile is selected, Outfitter MUST resolve only that profile and its declared `inherits` chain.
3. Outfitter MUST NOT include the configured `default_profile` as an implicit base layer for an explicit profile.

### OFTR-003.6: Profile Merging

1. Outfitter MUST merge resolved profile layers deterministically.
2. YAML object values SHOULD be merged with `defu` or an equivalent controlled deep-merge utility.
3. Array merge behavior MUST be documented per profile key before that key is treated as stable.
4. CLI-specific profile content MUST take precedence over generic controls when both generate the same agent-specific artifact.
5. Outfitter MUST compose `append_system_prompt` values from multiple resolved profile layers into repeated agent append-prompt inputs without requiring profiles to use raw CLI `args` for prompt composition.
6. Outfitter MUST merge `controls.deepwork.jobs` deterministically and remove duplicate job names while preserving inherited job order.

### OFTR-003.7: Template Profiles

1. A profile MAY set top-level `template: true` to indicate it is intended for inheritance by runnable profiles rather than direct launch.
2. Outfitter MUST allow template profiles to contribute controls through `inherits` without marking the inheriting profile as a template.
3. Outfitter MUST reject direct launches of template profiles, including launches selected through `default_profile`.
4. `outfitter profile list` SHOULD hide template profiles by default and MUST expose them when the user explicitly requests all profiles.

### OFTR-003.8: Generated Prompt Export Preference

1. A profile MAY set top-level `profile_export: true` to request generated prompt export for that profile.
2. A profile MAY set top-level `profile_export: false` to disable generated prompt export even when settings enable it by default.
3. Missing `profile_export` in a profile MUST defer to the effective settings default.
4. Outfitter MUST validate `profile_export` as a boolean when present.
