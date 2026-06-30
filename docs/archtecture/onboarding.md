# Onboarding Architecture

## Purpose

This document describes the current Pi-native Outfitter onboarding path. It is architecture documentation, not product copy: it explains the runtime decisions, generated Pi extension responsibilities, catalog source-of-truth, and custom UI behavior that keep first-run setup native to Pi without requiring an agent/model turn.

## Current First-Run Flow

A plain interactive `outfitter` launch uses Pi-native onboarding only when Outfitter cannot find `~/.outfitter/settings.yml`. Existing settings use the normal run path. Non-interactive Pi launches (`--print`, `-p`, `--export`, `--list-models`, JSON/print/RPC modes) MUST NOT open onboarding UI, auto-submit slash commands, sync first-run sources, or mutate Outfitter settings.

When first-run onboarding is active, `RunCommand` synchronizes the default profile catalog from `github: ai-outfitter/default-profiles` with `path: profiles`. The generated Pi bootstrap extension receives the synced cache path as `defaultProfilesPath`. The extension reads profile `id`, `label`, and `description` from cached catalog `profile.yml` files at runtime; profile picker entries are not hardcoded in the extension.

Before Pi starts, Outfitter prepares a generated CLI extension and launch environment:

- The generated extension registers `/outfitter` with `pi.registerCommand("outfitter", ...)`.
- The launch plan includes the generated extension with `--extension`.
- First-run onboarding writes Pi `settings.json` with `quietStartup: true` in the bootstrap Pi config directory so Pi startup resource listings stay quiet.
- First-run onboarding injects a temporary bootstrap model argument when needed to avoid Pi's pre-login no-model warning before the extension can open `/login`.
- The extension handles Pi `project_trust` and remembers trust for the exact project folder only. It returns `undecided` for parent folders and all non-first-run launches.

The extension opens `/outfitter` after Pi session start by setting the editor text and submitting Enter through a non-capturing hidden custom UI. This dispatches Pi's native slash command machinery without sending an agent message. If Pi reports no available models through `ctx.modelRegistry.getAvailable()` or equivalent runtime state, the extension opens Pi's native `/login` flow; Outfitter never asks for or stores provider credentials.

## Mermaid Flowchart

```mermaid
flowchart TD
  A[User runs outfitter] --> B{Interactive Pi launch?}
  B -- No --> B1[Use normal non-interactive launch path]
  B -- Yes --> C{~/.outfitter/settings.yml exists?}
  C -- Yes --> C1[Resolve configured default profile and launch normally]
  C -- No --> D[Sync ai-outfitter/default-profiles path: profiles]
  D --> E{Sync succeeded?}
  E -- No --> E1[Fail with setup guidance]
  E -- Yes --> F[Prepare generated Pi bootstrap extension]
  F --> G[Set quietStartup and first-run bootstrap launch options]
  G --> H[Launch Pi with --extension]
  H --> I[project_trust event]
  I --> I1[Trust exact project folder only]
  H --> J[session_start event]
  J --> K[Auto-submit /outfitter without agent turn]
  J --> L{Pi reports available models?}
  L -- No --> L1[Auto-submit /login]
  L -- Yes --> M[No login handoff]
  K --> N{Setup mode}
  N -- Default catalog --> O[Read cached catalog profile.yml files]
  O --> P[Custom profile picker]
  P --> P1[Founder highlighted by default when present]
  P --> Q[Choose install target]
  N -- Create profile --> R[Ask profile id and label]
  R --> Q
  N -- Import catalog --> S[Ask remote_settings source]
  S --> Q
  Q --> T{Install target}
  T -- Home --> U[Write ~/.outfitter/settings.yml]
  T -- Project --> V[Write <project>/.outfitter/settings.yml]
  U --> W[Notify restart required for selected profile]
  V --> W
```

## Native Command and Agent-Turn Boundary

`/outfitter` is a Pi extension command, not a prompt sent to the active model. The extension command owns all onboarding UI and filesystem writes. This boundary matters because first-run setup must work before the user has configured model credentials.

The bootstrap extension uses `ctx.ui.setEditorText("/outfitter")` plus a hidden `ctx.ui.custom(...)` component that submits Enter. That lets Pi's slash-command dispatcher run the extension command while avoiding a visible notification that Outfitter is opening setup. The same mechanism opens `/login` only after runtime model availability checks indicate no available models.

## Custom Profile Picker Nuance

Pi's public extension UI selector has a deliberately simple shape:

```ts
ctx.ui.select(title: string, options: string[]): Promise<string | undefined>
```

That API can show a shared title and a flat list of strings, but it cannot attach a per-option description that updates beside the highlighted row. Outfitter therefore uses `ctx.ui.custom(...)` only for the profile picker.

The custom picker renders:

- the fixed profile-setup title and guidance;
- one selectable row per synced catalog profile;
- only the selected profile's `description` to the right of that row;
- no description text for profiles without a `description` field;
- `↑`/`↓` navigation, Enter selection, and Escape/Ctrl+C cancellation.

The picker initializes on the current configured default profile when one exists. If no current default exists and `founder` is present in the synced catalog, it initializes on `founder` and labels it as recommended. Otherwise it initializes on the first sorted profile. Sorting still keeps `founder` first when present, then sorts remaining profiles by id.

Example shape:

```text
Outfitter profile setup

Choose the default profile from the selected catalog for future 'outfitter' launches.
The current Pi process keeps the profile it started with; this setting applies on the next launch.

→ founder — Founder (Recommended)  Founder-operator setup for building, product thinking, research checks, dense prose, and careful delivery.
  data_analyst — Data Analyst
  engineer — Engineer
```

## Setup Modes and Writes

The first onboarding question chooses one setup mode:

1. **Use the default Outfitter profile catalog** reads profile choices from the synced `ai-outfitter/default-profiles` cache, then writes `default_profile` and default `profile_sources` to the selected install target.
2. **Create your own profile** asks for a profile id and label, writes settings for a local profile source, and creates `<install-target>/.outfitter/profiles/<profile>/profile.yml` only if that file does not already exist.
3. **Provide a different catalog to import** writes `remote_settings` pointing at the user-provided `owner/repo`, `ref`, and settings path.

The final install target question writes either `~/.outfitter/settings.yml` or `<project>/.outfitter/settings.yml`. Profile changes selected after Pi has already started apply to the next `outfitter` launch, so onboarding must communicate that restart boundary.

## Cache and Staleness Implications

The default catalog is a remote source, but the profile picker reads the synchronized local cache passed to the generated extension. If the upstream default-profiles repository changes, an existing cache can remain stale until sync refreshes it. Seeing a removed profile in the picker usually means the first-run process is reading an old cache or a stuck sync process, not that the generated extension has hardcoded that profile.
