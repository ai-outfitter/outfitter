---
title: Remove hardcoded bootstrap model from onboarding
labels: [bug, m1-ship-blockers, plan-2026-07]
size: M
---

## Problem

First-run onboarding silently injects `--model google/gemini-3.1-pro-preview` (`code/cli/src/cli/commands/PiLoginLaunch.ts:79`) with no fallback logic. When Pi rotates its model catalog, the flagship `npm i -g && outfitter` flow starts erroring for every new user, and nothing in the output explains why.

## Scope

- Remove the hardcoded model ID.
- Query pi for available/authenticated models and pick a sensible default; if none can be determined, omit `--model` entirely and let pi apply its own default.
- Add a grep-style test gate: no model ID literals in `src/` outside test fixtures.

## Acceptance criteria

- Onboarding works with zero configured providers (routes into `/login`), with only Anthropic configured, and with only OpenAI configured.
- No hardcoded model identifiers remain in `code/cli/src/`.
- Regression test covers the "model no longer in catalog" scenario.

## References

- `code/cli/src/cli/commands/PiLoginLaunch.ts:79`
