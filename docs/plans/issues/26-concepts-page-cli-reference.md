---
title: Add a Concepts page and CLI command reference
labels: [documentation, m4-docs, plan-2026-07]
size: M
---

## Problem

The concept vocabulary is heavy — profile, composite profile, catalog, profile source, settings scope, loadout, remote settings, state paths — and there is no single page tying it together; the best mental-model text is buried in the 872-line architecture README. There is also no CLI reference: flags for `run`, `--strict`, `--agent`, `profile lint` are scattered across docs, and `outfitter welcome` appears in getting-started with zero explanation.

## Scope

- `docs/documentation/concepts.md`: one diagram (settings → sources → profile stack → composite → adapter → agent), one short paragraph per concept, the layer-precedence picture.
- `docs/documentation/cli.md`: every command and flag, generated from or verified against the commander definitions.
- Drift check: a test comparing `--help` output to the documented command surface.
- Link concept terms from other docs pages; explain or remove `welcome` from getting-started.

## Acceptance criteria

- Every concept term used in docs links to Concepts.
- Every command/flag documented; drift check in CI.

## References

- `docs/documentation/README.md`, `getting-started.md`
- `code/cli/src/cli/commands/`
