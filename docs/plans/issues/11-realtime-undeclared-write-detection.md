---
title: Near-real-time undeclared-write detection and crash coverage
labels: [enhancement, m2-hardening, plan-2026-07]
size: M
depends_on: [10]
---

## Problem

Undeclared-write detection only fires at clean process exit via fingerprint diffing (`code/cli/src/cli/commands/RunCommand.ts:176-184`, `StatePersistence.ts:63-120`). Multi-hour sessions get no feedback until the end; crashed or SIGKILLed sessions get none at all — writes are silently lost from the accounting, undermining "unknown writes are never silently persisted."

## Scope

- Extend the existing composite watcher (`CompositeProfileWatcher.ts`) to flag undeclared writes as they happen, with throttled/deduped notices.
- Persist a lightweight session journal (baseline fingerprint + observed writes) so a crashed session's undeclared writes are reported on the next invocation.
- Keep exit-time diff as the authoritative final pass.

## Acceptance criteria

- An undeclared write during a live session surfaces a notice within seconds.
- After a simulated crash (SIGKILL), the next `outfitter` invocation reports the prior session's undeclared writes.
- Tests for live-notice and post-crash paths.

## References

- `code/cli/src/compositeProfile/StatePersistence.ts:63-120`
- `code/cli/src/compositeProfile/CompositeProfileWatcher.ts:33-58`
- `code/cli/src/cli/commands/RunCommand.ts:176-184`
