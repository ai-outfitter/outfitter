---
title: 'Claude adapter: first-run/login onboarding path'
labels: [enhancement, claude-adapter, m3-claude-parity, plan-2026-07]
size: L
depends_on: [9]
---

## Problem

Onboarding is pi-only: `PiLoginLaunch.ts:32-34` no-ops for claude. There is no first-run experience for `--agent claude` — no binary detection guidance beyond a PATH error, no credential/login handoff, no profile picker parity. Claude is marketed as a peer adapter but a claude-first user gets none of the onboarding polish.

## Scope

- Detect missing claude binary; print guided install instructions (npm/brew per platform).
- Detect missing credentials; hand off to `claude /login` (or launch claude so its own login flow runs), returning to a working profile-driven session.
- Profile picker works on first run with `--agent claude` (terminal-side picker is acceptable; claude has no pi-tui equivalent for embedded UI).
- Respect the "credentials never touch Outfitter" rule.

## Acceptance criteria

- Clean machine with claude installed: `outfitter run --agent claude` reaches a working session with the chosen profile.
- Without claude installed: actionable guidance, no stack trace.
- Covered by integration tests with a stubbed claude binary.

## References

- `code/cli/src/cli/commands/PiLoginLaunch.ts:32-34`
- `code/cli/src/agents/ClaudeAdapter.ts`
- `docs/archtecture/onboarding.md`
