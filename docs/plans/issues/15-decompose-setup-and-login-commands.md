---
title: Decompose SetupCommand/PiLoginLaunch; remove lint escape hatches
labels: [tech-debt, m2-hardening, plan-2026-07]
size: L
depends_on: [9]
---

## Problem

The three highest-risk orchestration files disable the project's own quality gates: `SetupCommand.ts` (1,590 LoC), `PiLoginLaunch.ts` (885 LoC), and `RunCommand.ts` (640 LoC) open with `/* eslint-disable max-lines */` (plus `complexity` disables at `SetupCommand.ts:156`, `PiLoginLaunch.ts:1`). Complexity is concentrating exactly where onboarding bugs live, and ~90 `/* v8 ignore */` pragmas indicate coverage is partly satisfied by exclusion.

## Scope

- Extract flow modules: catalog source import, interactive prompt flows, welcome/settings persistence, login flow, run orchestration steps.
- Delete the `eslint-disable max-lines`/`complexity` headers; conform to the repo's `complexity: 10` / `max-lines: 500` rules.
- No behavior change — guarded by the existing suite plus the packaged E2E smoke.
- Reduce `/* v8 ignore */` count where extraction makes paths testable.

## Acceptance criteria

- No `eslint-disable max-lines|complexity` in `code/cli/src/cli/commands/`.
- Coverage thresholds still met without new ignore pragmas.

## References

- `code/cli/src/cli/commands/SetupCommand.ts`, `PiLoginLaunch.ts`, `RunCommand.ts`
