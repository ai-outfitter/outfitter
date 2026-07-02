---
title: 'Claude adapter: control mapping completeness (provider, thinking, prompt_template, deepwork)'
labels: [enhancement, claude-adapter, m3-claude-parity, plan-2026-07]
size: M
---

## Problem

Beyond MCP and skills (tracked separately), the claude adapter's generic-control coverage is loose or absent: `thinking` maps approximately to `--effort` (`ClaudeAdapter.ts:181`), while `provider`, `prompt_template`, and `deepwork` controls are warn-only (`ClaudeAdapter.ts:21-35`). The support matrix in `docs/archtecture/controllable-elements.md` marks Claude "Supported" for rows the code only partially honors.

## Scope

- Precise `thinking` → `--effort` mapping table (document each level's translation).
- For each remaining control (`provider`, `prompt_template`, `deepwork`, plus the five both-adapter Roadmap rows): decide implement vs. explicitly-Roadmap; implement the feasible ones; for the rest, ensure the warning text is accurate and asserted in tests.
- Verify `--strict` escalates every unsupported control to a failure.
- Reconcile the support matrix with actual behavior.

## Acceptance criteria

- Every Claude row in `controllable-elements.md` is either Supported (with a test) or Roadmap (with warning text asserted in a test).
- `--strict` behavior verified for all unsupported controls.

## References

- `code/cli/src/agents/ClaudeAdapter.ts:21-35,181`
- `docs/archtecture/controllable-elements.md`
