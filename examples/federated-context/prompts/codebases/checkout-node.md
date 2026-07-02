# Codebase: checkout-node (fictional example)

TypeScript/Node service that owns the cart and checkout flow. Owned by the payments team; the strangler-fig replacement target for billing-java's invoice-preview endpoints.

- Runtime: Node 22, Fastify, ESM only. Strict TypeScript; `npm run typecheck` must pass before any commit.
- Tests: Vitest. Unit tests colocated as `*.test.ts`; contract tests against billing-java's fixtures live in `contracts/` and are the source of truth during migration.
- Money is always integer minor units plus an ISO currency code (`{ amount: 1099, currency: 'USD' }`). Never use floats for money; never format currency outside the `presentation/` layer.
- All new endpoints must emit OpenTelemetry spans and register in `openapi.yaml`; CI fails on undocumented routes.
- When behavior differs from billing-java, billing-java is correct until the migration ledger in `MIGRATION.md` says otherwise.
