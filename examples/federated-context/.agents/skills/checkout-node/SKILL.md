---
name: checkout-node
description: Fictional checkout-node codebase constraints.
---

# Codebase: checkout-node

TypeScript/Node service that owns cart and checkout and replaces billing-java invoice previews.

- Node 22, Fastify, ESM, strict TypeScript; `npm run typecheck` must pass.
- Vitest unit tests are colocated; `contracts/` fixtures are authoritative during migration.
- Money is integer minor units plus ISO currency. Never use floats or format outside `presentation/`.
- New endpoints require OpenTelemetry spans and an `openapi.yaml` entry.
- When behavior differs, billing-java remains correct until `MIGRATION.md` says otherwise.
