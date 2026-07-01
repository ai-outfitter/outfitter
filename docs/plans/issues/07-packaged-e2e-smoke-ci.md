---
title: Add packaged E2E smoke test to CI (npm pack → global install → run)
labels: [enhancement, testing, m1-ship-blockers, plan-2026-07]
size: M
depends_on: [1, 2, 5]
---

## Problem

All 254 existing tests run in-process; the actual shipped artifact is never exercised. The exact flow that broke the demo recording — `npm install -g` on a machine that isn't a maintainer's — has zero CI coverage. Golden-tree fixtures verify composition logic but not packaging, bin wiring, bundled-pi resolution, or onboarding entry.

## Scope

- New CI job: `npm pack` in `code/cli`, install the tarball globally into a temp prefix, then run:
  - `outfitter --version` and `outfitter --help`
  - `outfitter profile list` against a fixture home
  - a smoke run through onboarding (`--smoke`-style flag or scripted TTY via `expect`/pty) far enough to prove pi launches with a composite profile
- Run on every PR; can land first as an allowed-failure canary, flip to required once M1 fixes are in.
- Log cold/warm first-boot timing (pairs with the first-boot-speed issue).

## Acceptance criteria

- CI fails when the published-artifact flow breaks (bin missing, bundled pi unresolvable, onboarding crash).
- Job runs in < ~5 minutes.

## References

- `code/cli/src/agents/AgentLaunch.ts:29-51` (bundled pi resolution — the kind of logic only a packaged test exercises)
- `.github/workflows/ci.yml`
