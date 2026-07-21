---
title: Implement the `prompt` state-persistence strategy
labels: [enhancement, m2-hardening, plan-2026-07]
size: M
---

## Problem

`prompt` is in the strategy union (`code/cli/src/compositeProfile/StatePersistence.ts:17`) and allowed for most pi/claude state paths (`PiAdapter.ts:38-44`, `ClaudeAdapter.ts:52-56`), but no code prompts anywhere — it silently degrades to a post-exit warning (`RunCommand.ts:368-374`). Profiles can configure behavior that does not exist; validation passes; the user is never asked.

## Scope

- On agent exit, for each `prompt`-strategy path with changes: interactive TTY prompt — persist / discard / always-persist-for-this-profile (writes the choice into the profile's `state_persistence`).
- Non-TTY (CI/scripted) falls back to `warn` with an explicit "prompt skipped: non-interactive" notice.
- Update `docs/documentation/state.md`; add/amend the relevant OFTR requirement.

## Acceptance criteria

- `prompt` paths actually prompt in a TTY; choices are honored and (for "always") persisted.
- Non-TTY behavior explicit and tested.
- Docs updated; no strategy in the union is a no-op.

## References

- `code/cli/src/compositeProfile/StatePersistence.ts:17`
- `code/cli/src/agents/PiAdapter.ts:38-44`, `ClaudeAdapter.ts:52-56`
- `code/cli/src/cli/commands/RunCommand.ts:368-374`
