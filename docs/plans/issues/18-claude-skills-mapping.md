---
title: 'Claude adapter: map generic skills control'
labels: [enhancement, claude-adapter, m3-claude-parity, plan-2026-07]
size: M
---

## Problem

Generic `controls.skills` is unsupported on the claude adapter and only warns (`code/cli/src/agents/ClaudeAdapter.ts:21-35`) — even though SKILL.md is now a cross-tool open standard read natively by Claude Code. Profiles with skills lose them silently (modulo a warning) when launched with `--agent claude`.

## Scope

- Materialize profile skills into the Claude composite's skills directory (verify current Claude Code skills discovery paths under `CLAUDE_CONFIG_DIR`).
- Apply the same unique-by-normalized-identity dedup used for pi (`ProfileMerger.ts:47-85`).
- Handle directory-layout profile skills (`skills/` subdir) and inherited skills.

## Acceptance criteria

- The same profile's skills are available in both pi and claude sessions.
- Golden-tree fixture covers claude skills materialization.
- Support matrix updated; warning removed.

## References

- `code/cli/src/agents/ClaudeAdapter.ts:21-35`
- `code/cli/src/profiles/ProfileMerger.ts:47-85`
