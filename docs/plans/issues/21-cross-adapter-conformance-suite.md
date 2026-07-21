---
title: Cross-adapter conformance test suite
labels: [testing, claude-adapter, m3-claude-parity, plan-2026-07]
size: L
depends_on: [17, 18, 20]
---

## Problem

Adapter parity claims have no enforcement mechanism — the claude adapter drifted behind the marketing once already, and nothing structural prevents it happening again as pi evolves or new adapters land. The support matrix is hand-maintained prose.

## Scope

- A conformance spec: for each generic control, a fixture profile plus per-adapter expected composite output/flags/warnings.
- Runs against every registered adapter (pi, claude today); an adapter declares Supported/Roadmap per control and the suite verifies the declaration matches behavior (supported ⇒ correct output; roadmap ⇒ correct warning; `--strict` ⇒ failure).
- Generate (or verify) the user-facing support matrix from suite results so docs cannot drift from code.

## Acceptance criteria

- One command proves the support matrix for all adapters.
- Adding a new adapter requires passing/declaring every conformance row.
- Docs matrix generated from or checked against results in CI.

## References

- `docs/archtecture/controllable-elements.md`
- `code/cli/tests/fixtures/integration/` (golden-tree pattern to build on)
