---
title: Extract the Pi onboarding extension into code/pi-extension as typed TypeScript
labels: [enhancement, tech-debt, m2-hardening, plan-2026-07]
size: L
---

## Problem

The Pi onboarding extension is a ~750-line untyped JavaScript string built with `String.raw` template interpolation (`code/cli/src/cli/commands/PiLoginLaunch.ts:127-150`), importing `@earendil-works/pi-tui` internals. It is never type-checked, linted, or executed against real pi in tests. Any pi-tui API change breaks onboarding at runtime with no compile-time signal. `code/pi-extension/` exists solely as a TODO acknowledging this (`code/pi-extension/README.md:3`). This is the single largest untested surface in the project — and it is the onboarding.

## Scope

- Implement the extension as real TypeScript in the `code/pi-extension` workspace, compiled at build time.
- Pass runtime values (settings paths, profile options, flags) via env vars/JSON file instead of string interpolation.
- CLI consumes the built artifact (bundled file or workspace dep).
- Unit tests against the pi-tui API surface; type-check against `@earendil-works/pi-tui` so pi upgrades fail loudly at build time.

## Acceptance criteria

- No `String.raw` extension bodies remain in `code/cli/src/`.
- `code/pi-extension` has its own tsconfig, tests, and lint; included in CI.
- Onboarding behavior unchanged (verified by the packaged E2E smoke).

## References

- `code/cli/src/cli/commands/PiLoginLaunch.ts:127-150`
- `code/pi-extension/README.md`
