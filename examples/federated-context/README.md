# Federated context example

A worked example of the [federated context pattern](../../docs/documentation/federated-context.md): one governed library of small, atomic context files, composed into per-role profiles so no single agent context window carries the whole organization.

Everything here is fictional — three made-up codebases, two made-up teams, and generic policies — sized so you can read the entire example in a few minutes.

```text
federated-context/
  .outfitter/
    settings.yml
    profiles/
      java-modernization.yml      # billing-java + checkout-node + payments team + tool policy
      inventory-forecasting.yml   # inventory-python + supply-chain team + tool policy + model policy
  prompts/
    codebases/
      billing-java.md
      checkout-node.md
      inventory-python.md
    teams/
      payments.md
      supply-chain.md
    tools/
      approved-toolchain.md
    models/
      model-policy.md
```

Each profile stays thin: a couple of lines of role framing plus `append_system_prompt` `{ file: ... }` includes selecting just the prompt files that role needs. Profile-owned `file:` includes resolve from the catalog root (the directory containing `.outfitter/`), which is what makes the shared `prompts/` library addressable from every profile.

## Try it

From a clone of this repository:

```bash
outfitter setup ./examples/federated-context
outfitter run --profile java-modernization
```

Validate after editing:

```bash
outfitter profile lint --strict
```

See the [federated context docs page](../../docs/documentation/federated-context.md) for composition mechanics (`file:` vs `repo_file:`), the governance model for the prompts library, and the honest limits of the pattern.
