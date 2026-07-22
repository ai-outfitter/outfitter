---
name: payments-team
description: Fictional payments-team working agreements.
---

# Team: payments

- Money-path changes ship behind a flag with a written rollback step.
- Amount, tax, proration, and refund changes require old/new behavior tests.
- Never log card data, bank identifiers, or full invoice payloads.
- Do not expand PCI scope without platform review.
- Escalate before migrations on shared billing tables.
