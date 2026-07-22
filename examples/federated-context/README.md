# Federated context example

A runnable `.agents` translation of the [federated context pattern](../../docs/documentation/federated-context.md): one governed library of atomic context skills, selected by thin role agents so a run only carries relevant organizational context.

```text
.agents/
  agents/
    java-modernization/agent.md
    inventory-forecasting/agent.md
  skills/
    billing-java/SKILL.md
    checkout-node/SKILL.md
    inventory-python/SKILL.md
    payments-team/SKILL.md
    supply-chain-team/SKILL.md
    approved-toolchain/SKILL.md
    model-policy/SKILL.md
```

From this directory:

```bash
cd examples/federated-context
outfitter run java-modernization
outfitter run inventory-forecasting
```

Each agent selects only the context skills it needs. Update one atomic skill by pull request and all
agents selecting it receive the reviewed change on the next catalog revision.
