# OFTR-010: Pi-Native Onboarding Welcome

## Overview

Outfitter onboarding gets a new user to a productive Pi session without a terminal readline
welcome flow. The default `outfitter` launch MUST start Pi first, then finish profile setup inside
Pi through a native Outfitter extension command named `/outfitter`. Explicit terminal commands such
as `outfitter setup` and `outfitter welcome` MAY still provide their documented direct CLI behavior.

## Requirements

### OFTR-010.1: Native Pi Onboarding Entry

1. When an interactive default `outfitter` launch finds no `~/.outfitter/settings.yml`, Outfitter MUST launch Pi with an Outfitter bootstrap extension instead of showing terminal welcome/readline prompts.
2. The bootstrap extension MUST register a native Pi command named `/outfitter` with `pi.registerCommand("outfitter", ...)`.
3. `/outfitter` MUST complete its onboarding UI without sending an agent/model message and MUST NOT require an available model.
4. Extension-command dispatch SHOULD take precedence over the published fallback `skills/outfitter` guidance where Pi command dispatch supports extension commands before skills.
5. Non-interactive Pi launches MUST NOT show onboarding UI, auto-submit onboarding commands, sync onboarding sources, or mutate Outfitter settings.

### OFTR-010.2: Profile Source and Default Profile Setup

1. The Pi-native onboarding flow MUST configure the shared default profile source as `github: ai-outfitter/default-profiles` with `path: profiles` unless a newer default is intentionally documented in this repository.
2. The Pi-native onboarding flow MUST persist the selected `default_profile` to `~/.outfitter/settings.yml`.
3. The profile picker MUST present loaded profile choices and MUST include `founder`, `engineer`, and `data_analyst` when the default-profiles source is available.
4. The first-run recommended choice SHOULD be `founder`.
5. If the selected profile is not present in loaded sources, Outfitter MAY create a local fallback profile under `~/.outfitter/profiles/<profile>/profile.yml`, but it MUST NOT overwrite an existing user profile file.
6. The onboarding UI MUST clearly communicate that profile/loadout changes made after Pi starts apply to the next `outfitter` launch.

### OFTR-010.3: Onboarding UI Surface

1. The onboarding UI SHOULD use a reusable ask-user-question Pi package API if source inspection proves a supported direct API exists for other extensions.
2. If no supported direct ask-user-question API exists, Outfitter MUST use a thin abstraction over native Pi `ctx.ui.*` dialogs so a reusable questionnaire API can be plugged in later.
3. The UI MUST keep credential collection outside Outfitter-managed prompts.
4. The UI MUST show Outfitter-branded text or notifications that explain Outfitter configures Pi profiles and extensions.

### OFTR-010.4: Pi Login Setup

1. The interactive Pi bootstrap extension MUST check runtime model availability with `ctx.modelRegistry.getAvailable()` and/or `ctx.model`.
2. If Pi reports no available models in interactive mode, Outfitter SHOULD open Pi's native `/login` flow automatically.
3. Pi login setup MUST NOT ask Outfitter to collect, echo, or persist provider API keys.
4. Non-interactive Pi launches MUST NOT auto-open `/login` or emit login guidance into the launch output stream.
5. Filesystem checks for Pi `auth.json` or `models.json` MAY be used as pre-start guidance, but they MUST NOT be the only signal used to decide whether login should open.

### OFTR-010.5: Explicit Terminal Setup Compatibility

1. Explicit `outfitter setup` behavior MUST remain available for users who choose terminal setup directly.
2. Explicit `outfitter welcome` behavior MAY remain available as a compatibility command, but the default first-run `outfitter` path MUST use Pi-native onboarding.
3. The published `skills/outfitter` fallback MUST remain available as documentation/guidance for environments where the native command is unavailable.
