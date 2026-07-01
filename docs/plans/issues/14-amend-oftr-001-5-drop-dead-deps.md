---
title: Amend OFTR-001.5 and remove dead dependencies
labels: [tech-debt, m2-hardening, plan-2026-07]
size: S
---

## Problem

`defu`, `glob`, `hosted-git-info`, and `typebox` are declared in `code/cli/package.json` but never imported anywhere in `src/`. A do-not-modify requirement test forbids removing them (`code/cli/tests/cli.test.ts:91-106`, pinning OFTR-001.5). The requirements-governance process is pinning a stale decision instead of tracking reality — and shipping unused supply-chain surface to every install.

## Scope

- Document a lightweight requirements-amendment process (note in `docs/requirements/README` or equivalent): how a pinned requirement gets revised, by whom, with what trace.
- Amend OFTR-001.5 to the actual dependency set.
- Remove the four dead deps; update the pinned test accordingly.

## Acceptance criteria

- Dead deps removed; `npm ls` clean; install size reduced.
- Amendment process documented; the pinned test references the amended requirement.

## References

- `code/cli/package.json`
- `code/cli/tests/cli.test.ts:91-106`
- `docs/requirements/OFTR-001`
