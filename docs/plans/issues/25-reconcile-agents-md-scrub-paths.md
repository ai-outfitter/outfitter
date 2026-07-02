---
title: Reconcile AGENTS.md, mark superseded plans, scrub leaked paths
labels: [documentation, m4-docs, plan-2026-07]
size: S
---

## Problem

Three front-door consistency issues:

1. `AGENTS.md:14` says "Pi is the only day-one adapter. Claude is roadmap-only unless requirements change" — contradicting OFTR-006 ("Outfitter MUST support Claude Code"), the architecture README, getting-started examples, and shipped code. Contributing agents get actively misled.
2. `docs/plans/setup-flow-refactor-deepplan.md` documents the superseded terminal setup flow (ASCII banner, terminal prompts) that OFTR-010 now forbids; nothing marks it superseded.
3. That plan leaks a developer's machine paths (`/home/ncrmro/repos/unsupervised/...`) and private repo names into the public repo.

## Scope

- Update AGENTS.md to current adapter reality and doc conventions.
- Add a SUPERSEDED banner convention for plan docs; apply to stale plans.
- Scrub personal machine paths and private repo names from all public docs.

## Acceptance criteria

- No contradictions between AGENTS.md, requirements, and README on adapter support.
- Superseded plans carry a banner naming what replaced them.
- No `/home/<user>` paths or private repo names in the repo.

## References

- `AGENTS.md:14`, `docs/requirements/OFTR-006`, `OFTR-010`
- `docs/plans/setup-flow-refactor-deepplan.md`
