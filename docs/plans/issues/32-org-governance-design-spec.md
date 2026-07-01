---
title: 'Org-catalog governance features: design spec'
labels: [strategy, design-spec, m5-strategic, plan-2026-07]
size: M
depends_on: [24, 31]
---

## Problem

The enterprise wedge is org-approved profile governance — the exact demand heard from the field (via Jamie, 2026-06-29: UPS/Home Depot wanting AI SDLC toolkits, approved stores, cost controls, auditability; DORA 2025 validating org-level AI standardization by platform teams). Pieces exist (`remote_settings`, `only`/`except` filters, budget-annotation pattern in the org use-case doc) but there is no coherent design for governance as a feature set, nor a decided OSS/enterprise boundary.

## Scope

Design spec only (docs/specs/); implementation issues spawn from it. Cover:

- Org-pinned `remote_settings`: approved profile sources, source allowlists, `ref` pinning policy.
- Enforcement modes: warn vs enforce when a user launches outside approved profiles.
- Audit trail: recording profile provenance (source, ref, resolved stack) per session.
- Model/cost policy: approved-model lists, default-model policy per role, budget annotations formalized.
- Federated context governance: who owns the prompts library, review flow (ties to the federated-context example issue).
- Explicit OSS vs enterprise-licensed boundary per feature.

## Acceptance criteria

- Reviewed spec with the OSS/enterprise boundary decided and an enumerated implementation-issue list.

## References

- `docs/documentation/usecases/orginization-profile-catalog.md`
- `docs/requirements/OFTR-002`
- Assessment §5 (market) and Jamie-call field signals
