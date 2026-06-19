# OFTR-003: Profiles and Inheritance

## Overview

Profiles describe reusable agent-CLI loadouts.
Outfitter resolves profile definitions across settings scopes, explicit sources, inherited profiles, and the implicit user default profile.

## Requirements

### OFTR-003.1: Profile Folder Layout

1. A profile MUST be represented by a folder with a required `profile.yml` file.
2. Outfitter MUST provide a JSON Schema for `profile.yml`.
3. Outfitter MUST validate every loaded `profile.yml` file against the profile JSON Schema.
4. A profile folder MAY contain conventional resource folders such as `skills`, `prompts`, and `extensions`.
5. A profile folder MAY contain `cli_specific/<cli-name>/` folders for agent-specific resources and overrides.

### OFTR-003.2: Profile Identity

1. Profile IDs MUST be stable identifiers suitable for commands, logs, cache keys, and documentation.
2. Profile IDs MUST match the regex `^[a-z0-9][a-z0-9._-]*[a-z0-9]$|^[a-z0-9]$`.
3. Outfitter MUST reject profile IDs that cannot be safely referenced from the CLI.
4. Outfitter SHOULD support a separate display label if human-readable names need spaces or punctuation.

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

### OFTR-003.5: Implicit Default Profile

1. The default profile from user settings MUST be included as an implicit bottom profile when running any explicit profile.
2. Profiles inherited by the implicit default profile MUST be included recursively below the default profile according to the inheritance rules.
3. Outfitter MUST avoid duplicating a profile in the resolved stack when the same profile appears explicitly and implicitly.

### OFTR-003.6: Profile Merging

1. Outfitter MUST merge resolved profile layers deterministically.
2. YAML object values SHOULD be merged with `defu` or an equivalent controlled deep-merge utility.
3. Array merge behavior MUST be documented per profile key before that key is treated as stable.
4. CLI-specific profile content MUST take precedence over generic controls when both generate the same agent-specific artifact.
