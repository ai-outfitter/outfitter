# OFTR-010: Onboarding Welcome

## Overview

Outfitter welcome onboarding gets a new user to a productive Pi session in one question. The
recommended path installs the founder profile automatically; declining opens `/outfitter` inside Pi
so the user can configure a profile interactively.

## Requirements

### OFTR-010.1: Welcome Text

1. Welcome text MUST be shown to the user explaining what Outfitter and Pi are and what the founder profile provides.
2. Welcome text MUST use Outfitter-branded ASCII/text.
3. Welcome text MUST reference `/outfitter` as the way to customize the profile after installation.

> Pi is a fully extensible agentic coding harness.
> The founder profile brings Pi to feature parity with dedicated agentic coding tools.
> Press Y to install it now. Run /outfitter inside Pi at any time to customize your profile.

### OFTR-010.2: Profile Installation

1. The welcome onboarding flow MUST present a single accept/decline prompt for the founder profile.
2. Accepting (default) MUST install the founder role and the full recommended loadout without further prompts.
3. The founder role MUST be the default and fallback selection. Outfitter's built-in role catalog also includes `engineer` and `data_analyst`; these are accessible via `/outfitter` after first run.
4. If the accepted role cannot be mapped to an available standard profile, Outfitter MUST warn the user and choose a deterministic fallback role rather than silently ignoring the selection.

### OFTR-010.3: Loadout

1. On acceptance, the full recommended loadout MUST be installed automatically with no item-level selection prompt.
2. The default recommended loadout MUST include `git:github.com/ai-outfitter/deepwork`, `npm:@juicesharp/rpiv-ask-user-question`, `git:github.com/applepi-ai/ulta-tasklist`, `npm:pi-nolo`, `npm:pi-browser-harness`, `npm:@mjakl/pi-subagent`, `npm:@narumitw/pi-btw`, `npm:pi-must-have-extension`, `npm:pi-interactive-shell`, and `npm:pi-mcp-adapter` while those packages remain available.
3. Loadout installation MUST be captured as structured onboarding data so profile creation can install the selected extensions deterministically.
4. On acceptance, Outfitter MUST display a message directing users to `/outfitter` inside Pi and `outfitter profile list` in the terminal for post-install management.
5. If a loadout item is unavailable or unsupported by the selected agent adapter, Outfitter MUST warn the user and continue with the remaining loadout items unless strict onboarding validation is enabled.
6. The Outfitter npm package MUST publish a default Pi skill named `outfitter` for profile setup guidance from inside Pi.
7. The Pi adapter MUST load the default Outfitter skill for normal profile launches.

### OFTR-010.4: Pi Login Setup

1. Before launching Pi after the welcome flow, Outfitter MUST detect whether native Pi appears to have no configured login state.
2. If Pi is not logged in after the welcome flow, Outfitter MUST automatically invoke Pi's `/login` flow when Pi starts.
3. When Outfitter launches Pi outside the welcome flow and Pi does not appear to be logged in, Outfitter MUST inform the user to run `/login` inside Pi.
4. Pi login setup MUST NOT ask Outfitter to collect, echo, or persist provider API keys.

### OFTR-010.5: Decline Path

1. If the user declines the welcome profile, Outfitter MUST launch Pi with `/outfitter` prefilled and auto-submitted so the user can configure a profile interactively on first session start.
2. The profile install target MUST always be the user home directory (`~/.outfitter`); no installation scope prompt MUST be shown.
