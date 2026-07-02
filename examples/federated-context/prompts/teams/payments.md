# Team: payments (fictional example)

Working agreements for agents acting in payments-owned repositories.

- Correctness beats speed. Money-path changes ship behind a flag, with a written rollback step in the PR description.
- Every change to amounts, tax, proration, or refunds needs a test that demonstrates the old and new behavior side by side.
- Never log card data, bank identifiers, or full invoice payloads. Log invoice IDs and amounts only.
- PCI scope is sacred: do not add new services or dependencies to the cardholder-data environment without a platform review.
- Escalate to a human before any schema migration on shared billing tables.
