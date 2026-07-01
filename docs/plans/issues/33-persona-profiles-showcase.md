---
title: Persona-profiles showcase
labels: [strategy, enhancement, m5-strategic, plan-2026-07]
size: M
---

## Problem

Persona reviews are a differentiated, product-shaped use case no competitor serves (rules-syncers and vendor marketplaces don't do it), and the docs already describe it well (`docs/documentation/usecases/persona-reviews.md`) — but there is no runnable catalog. A user convinced by the doc has to build everything from scratch.

## Scope

- Publish a `persona-reviews` set in the `ai-outfitter/default-profiles` catalog: founder-operator, staff-engineer, engineering-manager, platform-lead reviewer personas with the structured output shape from the doc (persona, artifact reviewed, first impression, top blocker, …).
- One-command path from the doc: `outfitter run --profile persona/staff-engineer` (or equivalent) against the user's artifact.
- Short write-up/blog post demonstrating a real review (e.g., personas reviewing Outfitter's own README — the docs already do this self-referentially).

## Acceptance criteria

- A user can run a persona review on their own docs in < 5 minutes starting from the use-case page.
- Personas ship in the default catalog with descriptions visible in the picker.

## References

- `docs/documentation/usecases/persona-reviews.md`
- `ai-outfitter/default-profiles` (companion repo work)
