# APPLEPI-REQ-010: Onboarding Welcome

## Overview

ApplePi welcome onboarding guides a new user through the minimum choices needed to start productive Pi sessions, including an initial role and a recommended loadout of extensions and skills.

## Requirements

### APPLEPI-REQ-010.1: Welcome Text

1. Welcome text MUST be shown to the user explaining what ApplePi and Pi are.

> Pi is a heavily customizable coding harness. The next few questions will configure ApplePi to best suit your workflow.

### APPLEPI-REQ-010.2: Role Selection

1. The welcome onboarding flow MUST ask the user to choose an initial role for the ApplePi-managed agent session.
2. Role choices MUST align with ApplePi's built-in standard role catalog, not DeepWork review personas or a remote default profile source.
3. The role selection prompt MUST include the currently available built-in standard profile roles, including `engineer` and `data_analyst` while those roles remain supported.
4. The selected role MUST be captured as structured onboarding data so profile creation or profile selection can map it to the matching standard profile ID.
5. If the selected role cannot be mapped to an available standard profile for the selected agent adapter, ApplePi MUST warn the user and choose a deterministic fallback role rather than silently ignoring the selection.

### APPLEPI-REQ-010.3: Loadout Selection

1. The welcome onboarding flow MUST recommend at least one default loadout for the selected role.
2. A loadout MUST be represented as a named set of Pi extensions, skills, or package resources that ApplePi can translate into profile controls or profile-managed Pi configuration.
3. The welcome onboarding flow MUST allow the user to accept the recommended loadout, select individual loadout items, or skip loadout installation.
4. The default recommended loadout MUST include `git:github.com/applepi-ai/ulta-tasklist`, `git:github.com/applepi-ai/deepwork`, `npm:pi-subagents`, and `npm:pi-mcp-adapter` while those packages remain available.
5. Loadout installation MUST be captured as structured onboarding data so future profile creation can install the selected extensions, skills, or package resources deterministically.
6. If a loadout item is unavailable or unsupported by the selected agent adapter, ApplePi MUST warn the user and continue with the remaining selected loadout items unless strict onboarding validation is enabled.

### APPLEPI-REQ-010.4: Pi Login Setup

1. Before launching Pi after the welcome flow, ApplePi MUST detect whether native Pi appears to have no configured login state.
2. If Pi is not logged in after the welcome flow, ApplePi MUST automatically invoke Pi's `/login` flow when Pi starts.
3. When ApplePi launches Pi outside the welcome flow and Pi does not appear to be logged in, ApplePi MUST inform the user to run `/login` inside Pi.
4. Pi login setup MUST NOT ask ApplePi to collect, echo, or persist provider API keys.
