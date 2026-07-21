---
title: Bundle an offline default profile; degrade gracefully when catalog sync fails
labels: [enhancement, m1-ship-blockers, plan-2026-07]
size: M
---

## Problem

First run hard-requires network + git. With no `~/.outfitter/settings.yml`, `outfitter` throws if `ai-outfitter/default-profiles` cannot be cloned (`code/cli/src/cli/commands/RunCommand.ts:410-418`; same for setup, `SetupCommand.ts:236-263`). Offline, proxied, or corporate-network users are dead-ended on the flagship `npm i -g && outfitter` flow. There is no bundled fallback profile despite `createDefaultSettingsContent` existing (`SetupCommand.ts:734`).

## Scope

- Ship a minimal built-in profile (working id: `starter`) inside the npm package — sane engineering defaults, no remote extensions required.
- On default-catalog sync failure during onboarding, warn clearly and fall back to the built-in profile instead of throwing ("degraded mode"). A later `outfitter sync` upgrades to the full catalog.
- Keep behavior identical when sync succeeds.
- Amend OFTR-010 to reflect degraded-mode onboarding as a requirement.

## Acceptance criteria

- With network blocked, `npm i -g @ai-outfitter/outfitter && outfitter` reaches a working Pi session using the bundled profile.
- Warning output names the failed source and explains how to retry (`outfitter sync`).
- Integration fixture covers the offline path; requirement test updated.

## References

- `code/cli/src/cli/commands/RunCommand.ts:410-418`
- `code/cli/src/cli/commands/SetupCommand.ts:236-263,734`
- `docs/requirements/OFTR-010`
