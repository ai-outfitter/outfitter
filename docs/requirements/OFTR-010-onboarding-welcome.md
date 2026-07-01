# OFTR-010: Pi-Native Onboarding Welcome

## Overview

Outfitter onboarding gets a user to a productive Pi session without a terminal readline welcome
flow. The default `outfitter` launch and every explicit `outfitter setup` form MUST start Pi first,
then finish profile setup inside Pi through a native Outfitter extension command named `/outfitter`.

## Requirements

### OFTR-010.1: Native Pi Onboarding Entry

1. When an interactive default `outfitter` launch finds no `~/.outfitter/settings.yml`, Outfitter MUST launch Pi with an Outfitter bootstrap extension instead of showing terminal welcome/readline prompts.
2. The bootstrap extension MUST register a native Pi command named `/outfitter` with `pi.registerCommand("outfitter", ...)`.
3. `/outfitter` MUST complete its onboarding UI without sending an agent/model message and MUST NOT require an available model.
4. Extension-command dispatch SHOULD take precedence over the published fallback `skills/outfitter` guidance where Pi command dispatch supports extension commands before skills.
5. Non-interactive Pi launches MUST NOT show onboarding UI, auto-submit onboarding commands, sync onboarding sources, or mutate Outfitter settings.
6. First-run Pi-native onboarding SHOULD automatically trust the exact project folder for Pi project-local resources without prompting the user, and MUST NOT automatically trust a parent folder.

### OFTR-010.2: Profile Source and Default Profile Setup

1. The Pi-native onboarding flow MUST ask first: `How would you like to set up Outfitter?` with the choices `Use the default Outfitter profile catalog`, `Create your own profile`, and `Provide a different catalog to import`.
2. The Pi-native onboarding flow MUST configure the shared default profile source as `github: ai-outfitter/default-profiles` with `path: profiles` unless a newer default is intentionally documented in this repository.
3. Default-catalog profile choices MUST be read from the synced default profile catalog and MUST NOT be generated from hardcoded local profile definitions.
4. The profile picker MUST present loaded profile choices and SHOULD include `founder`, `engineer`, and `data_analyst` when those profiles are present in the default-profiles source.
5. The first-run recommended choice SHOULD be `founder` when the loaded catalog includes it.
6. If the user chooses to create a profile, Outfitter MAY create a local profile under the selected install target's `.outfitter/profiles/<profile>/profile.yml`, but it MUST NOT overwrite an existing user profile file.
7. If the user provides a different catalog to import, Outfitter MUST persist it as `remote_settings`, for example:

   ```yaml
   remote_settings:
     - github: my_account/outfitter_config
       ref: main
       path: settings.yml
   ```

8. The final onboarding question MUST choose whether to install settings in the home folder or current project directory.
9. The Pi-native onboarding flow MUST persist selected home settings to `~/.outfitter/settings.yml` and selected project settings to `<project>/.outfitter/settings.yml`.
10. The onboarding UI MUST clearly communicate that profile/loadout changes made after Pi starts apply to the next `outfitter` launch.
11. When Pi-native onboarding imports a GitHub catalog and detects an HTTP 200 GitHub API response with `private: true`, it SHOULD ask before saving the catalog unless `enterprise.private_profile_catalogs: true` is already enabled in `~/.outfitter/settings.yml`.
12. The Pi-native private catalog prompt MUST use this text:

    ```text
    Private GitHub profile catalog detected: OWNER/REPO.

    Private profile catalog support is covered by the Outfitter Enterprise license.
    Review code/enterprise/LICENSE or your enterprise agreement before enabling.

    Enable private profile catalogs in ~/.outfitter/settings.yml and use this catalog?
    ```

13. The Pi-native choices MUST be:

    ```text
    Enable and continue
    Cancel private catalog setup
    ```

14. If the user accepts, Pi-native onboarding MUST write `enterprise.private_profile_catalogs: true` to `~/.outfitter/settings.yml`, save the catalog, and show:

    ```text
    Outfitter enabled private profile catalogs in ~/.outfitter/settings.yml and saved this catalog.
    ```

15. If the user declines, Pi-native onboarding MUST leave settings unchanged, not save the catalog, and show:

    ```text
    Private catalog setup was cancelled; no settings were changed.
    ```

16. If `enterprise.private_profile_catalogs: true` is already enabled in `~/.outfitter/settings.yml`, Pi-native onboarding MUST NOT show private-catalog enterprise information or prompts.
17. Pi-native onboarding MUST NOT collect, echo, persist, synthesize, or validate provider credentials for private catalogs.

### OFTR-010.3: Onboarding UI Surface

1. The onboarding UI SHOULD use a reusable ask-user-question Pi package API if source inspection proves a supported direct API exists for other extensions.
2. If no supported direct ask-user-question API exists, Outfitter MUST use a thin abstraction over native Pi `ctx.ui.*` dialogs so a reusable questionnaire API can be plugged in later.
3. The UI MUST keep credential collection outside Outfitter-managed prompts.
4. The UI MUST show Outfitter-branded text or notifications that explain Outfitter configures Pi profiles and extensions.
5. First-time Pi-native onboarding SHOULD show additional startup text explaining that Outfitter uses profiles, settings, and catalogs to configure Pi.
6. Outfitter startup branding SHOULD include ASCII/brand art by default and MUST allow users to disable it with `startup.ascii_art: false` in `settings.yml`.

### OFTR-010.4: Pi Login Setup

1. The interactive Pi bootstrap extension MUST check runtime model availability with `ctx.modelRegistry.getAvailable()` and/or `ctx.model`.
2. If Pi reports no available models in interactive mode, Outfitter SHOULD open Pi's native `/login` flow automatically.
3. Pi login setup MUST NOT ask Outfitter to collect, echo, or persist provider API keys.
4. Non-interactive Pi launches MUST NOT auto-open `/login` or emit login guidance into the launch output stream.
5. Filesystem checks for Pi `auth.json` or `models.json` MAY be used as pre-start guidance, but they MUST NOT be the only signal used to decide whether login should open.

### OFTR-010.5: Explicit Setup Entry

1. Explicit `outfitter setup` MUST launch Pi-native onboarding rather than terminal setup prompts.
2. `outfitter setup <source>` MUST pass the provided source into Pi-native onboarding so setup writes happen from inside Pi.
3. The published `skills/outfitter` fallback MUST remain available as documentation/guidance for environments where the native command is unavailable.
