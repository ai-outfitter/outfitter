# Federated context

Large organizations often have many codebases and teams but one finite context window. Copying
rules between repositories drifts; loading the entire organization into every run wastes context.

The federated-context pattern uses:

1. **One governed context library** — small, atomic Agent Skills for each codebase, team, tool
   policy, or model policy.
2. **Thin agents selecting subsets** — each agent's `skills:` loadout names only the context needed
   for its role.

The repository includes a runnable [federated-context example](../../examples/federated-context/README.md).

## Structure

```text
.agents/
  agents/
    java-modernization/agent.md    # selects billing, checkout, payments, tools
    inventory-forecasting/agent.md # selects inventory, supply chain, tools, model policy
  skills/
    billing-java/SKILL.md
    checkout-node/SKILL.md
    inventory-python/SKILL.md
    payments-team/SKILL.md
    supply-chain-team/SKILL.md
    approved-toolchain/SKILL.md
    model-policy/SKILL.md
```

Keep each context skill atomic. A file spanning several concerns can no longer be selected, owned,
reviewed, or retired independently.

## Composition

An agent selects its context by slug:

```markdown
---
name: java-modernization
skills: [billing-java, checkout-node, payments-team, approved-toolchain]
---

Consult every selected context skill before proposing a migration change.
```

Outfitter resolves those slugs through normal layer precedence and materializes the winning skill
packages for the harness. Catalog updates remain deterministic when consumers pin a source `ref`.

## Governance

- Assign one owner per context skill with `CODEOWNERS` and branch protection.
- Change shared context by pull request with review from the owning team and platform team.
- Release and pin catalog revisions so consumers adopt reviewed changes deliberately.
- Keep role framing in agents and reusable facts/policy in context skills.

## Limits

- Authoring and reviewing accurate context is real work.
- Context still goes stale and still consumes tokens when loaded.
- Skill routing is progressive; agents should explicitly consult required context skills before
  acting when every constraint must be loaded up front.
- Static selection is intentional. Outfitter does not infer which organizational policy applies to
  a task.
