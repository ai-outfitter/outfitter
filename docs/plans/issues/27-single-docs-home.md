---
title: 'Single docs home: doc site renders docs/documentation'
labels: [documentation, m4-docs, plan-2026-07]
size: L
depends_on: [22, 26]
---

## Problem

`code/doc_site` (Nextra/Next 16) has exactly two pages (landing + state-persistence) while the real documentation lives in `docs/documentation/`. Two doc surfaces guarantee divergence — the state-persistence page already duplicates `state.md` content.

## Scope

- Doc site consumes `docs/documentation/*` as its content source (build-time copy, symlink, or content pipeline) so a doc change edits exactly one file.
- Site nav mirrors the documentation index; landing page keeps the marketing copy.
- Deploy pipeline (Vercel/Pages) wired to main.
- Fix the landing page's fictional details flagged in review (e.g., `github:nhorton/agent-profiles` example, invented "17 controls merged" output) to use real, reproducible examples.

## Acceptance criteria

- Publishing a doc change requires editing one file under `docs/documentation/`.
- Site deployed with full docs; no duplicated content files.

## References

- `code/doc_site/app/page.mdx`, `app/state-persistence/page.mdx`
- `docs/documentation/`
