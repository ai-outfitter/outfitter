---
title: 'Federated-context pattern: worked example'
labels: [strategy, documentation, m5-strategic, plan-2026-07]
size: M
depends_on: [24]
---

## Problem

The "federated context layer" is named enterprise demand (Home Depot via Jamie, 2026-06-29: 50 legacy repos, per-team context selection without bloating any one context window). Outfitter already supports the answer — atomic markdown libraries (`/prompts/{codebases,teams,tools,models}`) composed per-profile via `append_system_prompt` file/repo_file includes — but it exists only as conversation, not as a documented pattern anyone can adopt.

## Scope

- Example catalog repo demonstrating the pattern: a `prompts/` library of atomic files (several fake codebases, teams, tool policies, model policies) plus profiles that compose subsets ("java-modernization" pulls 2 codebases + 1 team + tool policy).
- Docs page walking the pattern: structure, composition mechanics, the governance angle (a governance team owns the prompts library; profiles stay thin), scaling notes and honest limits (it's real work to author; agents can draft but humans must review).
- Link from the org-catalog use case.

## Acceptance criteria

- Cloneable example demonstrating 50-codebase-style composition.
- Docs page published and linked from the org use case.

## References

- `docs/documentation/profiles.md` (append_system_prompt file/repo_file)
- Jamie call transcript (2026-06-29): federated context discussion
