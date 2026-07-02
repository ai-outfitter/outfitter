---
title: Surface Supported-vs-Roadmap status in user docs
labels: [documentation, m4-docs, plan-2026-07]
size: S
depends_on: [21, 27]
---

## Problem

A new user cannot tell what works per adapter without reading `docs/archtecture/controllable-elements.md` (an architecture file). Meanwhile README/docs present Claude as a peer even where support is partial — the honest matrix exists but is invisible to the audience that needs it.

## Scope

- Move or mirror the support matrix into `docs/documentation/` with per-adapter status badges (Supported / Partial / Roadmap).
- Link prominently from README ("What works today").
- Once the cross-adapter conformance suite lands, generate or verify this table from suite results.

## Acceptance criteria

- README links a matrix a new user can parse in 30 seconds.
- Matrix consistent with conformance-suite results (CI-checked once available).

## References

- `docs/archtecture/controllable-elements.md`
- Cross-adapter conformance suite issue
