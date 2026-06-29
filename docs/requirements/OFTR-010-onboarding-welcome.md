# OFTR-010: Onboarding Welcome

## Overview

Outfitter welcome onboarding gets a new user to a productive Pi session by first asking whether to use the default Outfitter catalog, create a profile, or import a different catalog. The recommended path syncs `https://github.com/ai-outfitter/default-profiles`, then presents discovered default profiles, installs the selected profile as the default, and keeps `/outfitter` available inside Pi for later customization. If the user chooses profile creation or no catalog profiles are available, Outfitter opens `/outfitter` inside Pi so the user can configure a profile interactively.

## Requirements

### OFTR-010.1: Welcome Text

1. Welcome text MUST be shown to the user explaining what Outfitter and Pi are and that Outfitter can start from shared profiles.
2. Welcome text MUST use Outfitter-branded ASCII/text.
3. Welcome text MUST reference `/outfitter` as the way to customize the profile after installation.
4. Every interactive `outfitter setup` path MUST render the shared Outfitter-branded ASCII welcome before prompting.
5. First-run welcome text MUST mention `https://github.com/ai-outfitter/default-profiles` before the user selects the default catalog or a shared profile.
6. First-run welcome text MUST demonstrate that shared-profile setup is recorded with `remote_settings` using `github: ai-outfitter/default-profiles`, `ref: main`, and `path: settings.yml`.

> Pi is a fully extensible agentic coding harness.
> Outfitter configures Pi with shared profiles and extensions.
> Run /outfitter inside Pi at any time to customize your profile.

### OFTR-010.2: Profile Installation

1. The first-run welcome onboarding flow MUST make the first interactive question a setup-path choice between the default Outfitter catalog, creating a profile, and providing a different catalog to import.
2. When loaded catalog profiles are available after a catalog is selected and loaded, the profile question MUST present those profiles as keyboard-selectable choices derived from loaded profile data.
3. The shared profile choice list MUST preserve each loaded profile's `id`, `label`, and `description` when those fields are available.
4. The first-run default selection path MUST NOT hardcode a founder/engineer/data analyst role catalog in setup or welcome code.
5. If the selected shared profile cannot be mapped to an available loaded profile, Outfitter MUST warn the user and choose a deterministic fallback from the loaded choices rather than silently ignoring the selection.
6. Persisting an accepted shared profile MUST copy the selected remote profile locally without overwriting an existing user profile file.
7. When the selected profile exists in the shared source, persisted local profile content MUST come from that source and MUST NOT inject stale hardcoded role prompts.
8. If the user chooses profile creation or no loaded catalog profiles are available, first-run onboarding MUST skip profile installation and launch Pi with `/outfitter` prefilled and auto-submitted.
9. When the default Outfitter catalog path is selected, the flow MUST synchronize and load the shared source through `remote_settings` before the profile choice is resolved.
10. If the user chooses to provide a different catalog, first-run onboarding MUST prompt for the catalog source and use the setup-source import flow rather than falling through to the default catalog.

### OFTR-010.3: Shared Profile Loadout

1. On selection, the selected shared profile MUST be installed automatically with no item-level loadout prompt.
2. The default recommended loadout MUST be defined by the selected shared profile source rather than by a first-run hardcoded role catalog.
3. Shared profile installation MUST be captured as structured onboarding data so profile persistence can install the selected profile deterministically.
4. On selection, Outfitter MUST display a message directing users to `/outfitter` inside Pi and `outfitter profile list` in the terminal for post-install management.
5. If a shared profile or loadout item is unavailable or unsupported by the selected agent adapter, Outfitter MUST warn the user and continue with the remaining loaded profile data unless strict onboarding validation is enabled.
6. The Outfitter npm package MUST publish a default Pi skill named `outfitter` for profile setup guidance from inside Pi.
7. The Pi adapter MUST load the default Outfitter skill for normal profile launches.

### OFTR-010.4: Pi Login Setup

1. Before launching Pi after the welcome flow, Outfitter MUST detect whether native Pi appears to have no configured login state.
2. If Pi is not logged in after an accepted profile-catalog welcome flow, Outfitter MUST automatically invoke Pi's `/login` flow when Pi starts.
3. When Outfitter launches Pi interactively outside the welcome flow and Pi does not appear to be logged in, Outfitter MUST inform the user to run `/login` inside Pi.
4. Non-interactive Pi launches MUST NOT auto-open `/login` or emit login guidance into the launch output stream.
5. Pi login setup MUST NOT ask Outfitter to collect, echo, or persist provider API keys.

### OFTR-010.5: Slash Handoff Path

1. If no shared default profiles are available during first-run welcome onboarding or the user chooses to create a profile, Outfitter MUST launch Pi with `/outfitter` prefilled and auto-submitted so the user can configure a profile interactively on first session start.
2. The profile install target question MUST default to the user home directory (`~/.outfitter`) so the configuration is available across projects.
3. The profile install target question MAY offer the current project directory (`<project>/.outfitter`) for repository-scoped configuration.
