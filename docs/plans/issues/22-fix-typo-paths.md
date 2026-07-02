---
title: Fix typo'd doc paths (docs/archtecture, orginization-profile-catalog.md)
labels: [documentation, m4-docs, plan-2026-07]
size: S
---

## Problem

Two typos are baked into public link paths while the repo is young: the `docs/archtecture/` directory ("architecture") and `docs/documentation/usecases/orginization-profile-catalog.md` ("organization"). The archtecture typo is propagated into CONTRIBUTING.md links. Every week these survive, more external links accrue.

## Scope

- `git mv docs/archtecture docs/architecture`; rename the use-case file.
- Update every in-repo reference (README, CONTRIBUTING, docs index, doc site, requirement docs, code comments).
- Grep gate in CI or a test: `archtecture|orginization` must not appear.

## Acceptance criteria

- Zero occurrences of the typo'd strings in the repo.
- All internal links resolve (link check).

## References

- `docs/archtecture/`, `docs/documentation/usecases/orginization-profile-catalog.md`
- `CONTRIBUTING.md`
