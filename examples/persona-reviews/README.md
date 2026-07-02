# Persona reviews example catalog

A runnable version of the [persona reviews use case](../../docs/documentation/usecases/persona-reviews.md): simulated reviewer personas that read an artifact — a README, docs page, onboarding flow, spec, or website copy — and return structured feedback from a distinct buyer or user viewpoint.

| Profile                       | Reviews whether…                                                   |
| ----------------------------- | ------------------------------------------------------------------ |
| `persona-founder-operator`    | a hands-on founder gets obvious leverage in the first hour         |
| `persona-staff-engineer`      | the product is credible for complex technical work                 |
| `persona-engineering-manager` | a team could adopt it safely (rollout, training, risk ownership)   |
| `persona-platform-lead`       | trust boundaries and operations fit an internal developer platform |

All four inherit `persona-review-base`, a `template: true` profile that pins the shared rules and the structured output shape: persona, artifact reviewed, first impression, top blocker, strongest value signal, confusing language, suggested change, and confidence.

## Run it

From a clone of this repository:

```bash
outfitter setup ./examples/persona-reviews
outfitter run --profile persona-staff-engineer
```

Then hand the session the artifact to review:

```text
Read README.md and docs/getting-started.md for <your product>. As the
staff-engineer persona, return the structured review.
```

## Honest limits

These personas are simulations. They read your artifact through a persona-shaped prompt; they do not have real customers' context, budgets, or organizational pressure, and they are explicitly instructed never to invent customer quotes, usage data, or research findings. Use them to find obvious blockers cheaply before asking real prospects to spend time on a review — not to replace customer discovery.

The profiles set thinking levels but deliberately pin no provider or model, so they run with whatever your default agent configuration provides. Add `provider`/`model` controls if you want repeatable model choices per persona.
