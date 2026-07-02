---
title: Expand profile catalog docs + trust model
labels: [documentation, security, m4-docs, plan-2026-07]
size: M
---

## Problem

Profile catalogs are the headline sharing feature ("Individuals, teams, and organizations can share and compose repeatable agent profiles") but `docs/documentation/profile-repository.md` is ~30 lines. There is no guidance on authoring, versioning/`ref` pinning, `only`/`except` filters, private repos, or `remote_settings` — those details live only in OFTR-002 and the 872-line architecture README. Critically, there is no trust-model documentation, even though an imported catalog can inject extensions, args, and env into agent launches (a CSA-flagged supply-chain surface; Pi's own docs warn packages run with full system access).

## Scope

- Expand `profile-repository.md`: authoring a catalog repo, layout conventions, `ref` pinning, `only`/`except`, private repos/auth, `remote_settings`, versioning and update flow (`outfitter sync`).
- New "Trust and review" section: what a catalog can do to your machine, a review checklist before adding a source, recommendation to pin `ref`s for org catalogs.
- Link the trust section from `outfitter setup` output when adding a remote source.

## Acceptance criteria

- A team can publish and consume a catalog using only this doc.
- Trust section exists, is linked from setup output, and is honest about the execution surface.

## References

- `docs/documentation/profile-repository.md`
- `docs/requirements/OFTR-002`, `OFTR-004`
