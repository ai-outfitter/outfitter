---
title: Clean up composite temp dirs on exit
labels: [bug, security, m2-hardening, plan-2026-07]
size: S
---

## Problem

Composite profile directories are created with `mkdtemp` (`CompositeProfileAssembler.ts:20-21`) but never removed — there is no `rmSync` in `RunCommand.ts` or the assembler. Every run leaks a `$TMPDIR/outfitter-<profile>-<agent>-<random>/` directory containing symlinks into real auth/settings state (`~/.pi/agent/auth.json`, `~/.claude/*`). Accumulating dirs with auth-adjacent symlinks is both hygiene and mild security debt.

## Scope

- Remove the composite dir on normal agent exit (and on handled signals).
- Keep the dir when `--debug` is passed, printing its path.
- Best-effort startup sweep of stale `outfitter-*` dirs older than N days.

## Acceptance criteria

- No orphaned composite dirs after a clean run.
- `--debug` preserves the dir and says so.
- Tests cover cleanup, debug-preserve, and the sweep.

## References

- `code/cli/src/compositeProfile/CompositeProfileAssembler.ts:20-21`
- `code/cli/src/agents/PiAdapter.ts:406-440`, `ClaudeAdapter.ts:148-173` (symlinked state)
