# Persona Reviews

A persona review catalog is a shared setup source that publishes profiles representing the kinds of people who might use a product, service, internal tool, or documentation site. Teams can launch these personas to get structured feedback on docs, onboarding, website copy, setup flows, and UX before asking real prospects or customers to spend time on a review.

The example below uses Outfitter itself as the product being reviewed, but the pattern is meant for your own product. Replace the persona files, concerns, and review prompts with the customer types you care about.

## Run it now

The Outfitter repository ships a runnable persona catalog in [`examples/persona-reviews`](../../../examples/persona-reviews/README.md) with four reviewer personas: `persona-founder-operator`, `persona-staff-engineer`, `persona-engineering-manager`, and `persona-platform-lead`. From a clone of the repository:

```bash
outfitter setup ./examples/persona-reviews
outfitter run --profile persona-staff-engineer
```

Then hand the session the artifact to review:

```text
Read README.md and docs/getting-started.md for <your product>. As the
staff-engineer persona, return the structured review.
```

Each persona returns the structured shape from [Review output pattern](#review-output-pattern) below. The personas are simulations — they are instructed to say so and to never invent customer quotes, usage data, or research findings. Treat their feedback as a cheap first pass, not a replacement for talking to real customers.

## Catalog layout

A persona review catalog for your own product follows the standard setup-source shape:

```text
customer-persona-reviews/
  settings.yml
  personas/
    base-customer-persona.yml
    founder-operator.yml
    staff-engineer.yml
    engineering-manager.yml
    platform-lead.yml
    agency-consultant.yml
```

## Catalog settings

```yaml
# customer-persona-reviews/settings.yml
profile_sources:
  - path: ./personas
```

The base profile below is marked `template: true`, so personas can inherit it while it never appears as a launchable choice. Avoid `only:` filters that omit an inherited base profile — filtered-out profiles are not loaded at all, so inheritance from them fails.

## Shared base profile

```yaml
# personas/base-customer-persona.yml
id: base-customer-persona
label: Customer Persona Base
template: true
description: Shared rules for reviewing an artifact from a customer persona's point of view.
controls:
  append_system_prompt: |
    Review as the assigned customer persona. Read or experience the provided artifact
    from that persona's point of view: docs, screenshots, website, prototype, product
    flow, or onboarding path. Distinguish evidence from assumptions, cite the exact
    page or UI moment that shaped your reaction, and do not invent real customer research.
```

## Persona profiles

Persona review catalogs SHOULD make each potential customer's job, anxieties, buying triggers, and expected feedback shape explicit. These examples use Outfitter as the reviewed product so the pattern is concrete; replace the product references with your own product, audience, and UX.

```yaml
# personas/founder-operator.yml
id: founder-operator
label: Founder Operator
description: Reviews whether a product helps a hands-on founder get leverage quickly.
inherits:
  - base-customer-persona
controls:
  provider: anthropic
  model: anthropic/claude-sonnet-4
  thinking: high
  append_system_prompt: |
    You are a technical founder who writes product specs, edits docs, ships small
    features, and manages a thin team. For this example, review Outfitter as the
    product. Say whether the first hour feels obviously valuable. Flag jargon, setup
    friction, unclear pricing or trust boundaries, and anything that delays the first
    useful outcome.
```

```yaml
# personas/staff-engineer.yml
id: staff-engineer
label: Staff Engineer
description: Reviews whether a product is credible for complex technical work.
inherits:
  - base-customer-persona
controls:
  provider: anthropic
  model: anthropic/claude-sonnet-4
  thinking: high
  append_system_prompt: |
    You are a staff engineer responsible for large codebases, architecture decisions,
    reviews, and cross-team technical quality. For this example, review Outfitter as
    the product. Say whether the docs explain how the product improves real engineering
    work. Flag missing examples, weak verification paths, and claims that need evidence.
```

```yaml
# personas/engineering-manager.yml
id: engineering-manager
label: Engineering Manager
description: Reviews whether a product helps a team standardize work safely.
inherits:
  - base-customer-persona
controls:
  provider: openai
  model: openai/gpt-4.1
  thinking: medium
  append_system_prompt: |
    You manage engineers with different tool habits. For this example, review Outfitter
    as the product. Say whether team defaults, onboarding, review expectations, and
    governance are understandable. Flag anything that makes rollout, support, training,
    or risk ownership unclear.
```

```yaml
# personas/platform-lead.yml
id: platform-lead
label: Platform Lead
description: Reviews whether a product can fit into internal developer platform workflows.
inherits:
  - base-customer-persona
controls:
  provider: anthropic
  model: anthropic/claude-opus-4
  thinking: xhigh
  append_system_prompt: |
    You own internal developer tooling, CI, secrets, and fleet-wide standards. For this
    example, review Outfitter as the product. Focus on trust boundaries, credential
    handling, catalog governance, private repo assumptions, reproducibility, and
    operational failure modes. Prioritize risks that would block enterprise rollout.
```

```yaml
# personas/agency-consultant.yml
id: agency-consultant
label: Agency Consultant
description: Reviews whether a product helps switch between multiple client contexts cleanly.
inherits:
  - base-customer-persona
controls:
  provider: openai
  model: openai/gpt-4.1-mini
  thinking: low
  append_system_prompt: |
    You work across multiple client contexts and need repeatable setup without leaking
    one client's context into another. For this example, review Outfitter as the product.
    Say whether the docs and UX make isolation, project settings, and switching contexts
    obvious.
```

## Review workflows

A persona review can inspect static docs or interact with a running UX. The prompt should say which artifact is under review and what kind of feedback is useful. For your own product, swap in your own docs, prototype URL, screenshots, local app, or onboarding flow.

```text
Read README.md, docs/getting-started.md, and docs/pricing.md for <your product>.
As the staff-engineer persona, explain where the product feels credible, where it feels
underspecified, and what one example would most improve your confidence.
```

```text
Browse <your product>'s local documentation site and try the first-run setup flow.
As the founder-operator persona, report the first confusing moment, the first moment
that felt valuable, and whether you would keep using the product after setup.
```

## Review output pattern

Persona profiles SHOULD define a repeatable response shape so feedback from different potential customers is comparable.

```yaml
# personas/founder-operator.yml excerpt
controls:
  append_system_prompt: |
    Return feedback as: persona, artifact reviewed, first impression, top blocker,
    strongest value signal, confusing language, suggested change, and confidence.
    If you need more context, ask for the smallest missing artifact.
```

This gives a team a reusable customer-persona review catalog: each agent reads docs or experiences a UX from a distinct buyer/user viewpoint, then returns structured feedback without pretending to replace real customer discovery.
