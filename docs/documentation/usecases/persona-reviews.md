# Persona Reviews

A persona review catalog gathers structured feedback on a product, docs, onboarding flow, or UX from the points of view of the people who might use it — before asking real prospects to spend time. It uses the [persona convention](../personas.md): **one base review agent** plus a **directory of persona description documents**, run once per document.

There is no `personas:` map and no agent per customer type. The review rules live in a single agent; each persona is a cheap markdown file you feed it as input.

```text
customer-review/                 # standalone .agents repo; root is the payload
  agents/
    reviewer/agent.md            # the base review agent
  settings.yml
docs/user-personas/
  founder-operator.md            # persona description documents
  staff-engineer.md
  engineering-manager.md
  platform-lead.md
  agency-consultant.md
```

## Settings

Settings only names the default agent and where resources resolve from — no persona list:

```yaml
# settings.yml
default_agent: reviewer
```

## The base review agent

One agent holds the review method and the output shape. It does not name any customer type; it reads the persona document it is told to adopt.

```
<!-- agents/reviewer/agent.md -->
---
name: reviewer
description: Reviews an artifact from the point of view of an assigned customer persona.
---

Adopt the persona description document named in your instructions. Read or
experience the provided artifact from that persona's point of view: docs,
screenshots, website, prototype, product flow, or onboarding path.
Distinguish evidence from assumptions, cite the exact page or UI moment that
shaped your reaction, and do not invent real customer research.

Return feedback as: persona, artifact reviewed, first impression, top blocker,
strongest value signal, confusing language, suggested change, and confidence.
If you need more context, ask for the smallest missing artifact.
```

## Persona description documents

Each file makes one potential customer's job, anxieties, buying triggers, and expected feedback shape explicit. These are plain docs — no frontmatter, no protocol shape required.

```
<!-- docs/user-personas/founder-operator.md -->
# Founder-operator

A technical founder who writes product specs, edits docs, ships small
features, and manages a thin team. Cares whether the first hour feels
obviously valuable. Flags jargon, setup friction, unclear pricing or trust
boundaries, and anything that delays the first useful outcome.
```

```
<!-- docs/user-personas/staff-engineer.md -->
# Staff engineer

Responsible for large codebases, architecture decisions, reviews, and
cross-team technical quality. Cares whether the docs explain how the product
improves real engineering work. Flags missing examples, weak verification
paths, and claims that need evidence.
```

```
<!-- docs/user-personas/platform-lead.md -->
# Platform lead

Owns internal developer tooling, CI, secrets, and fleet-wide standards.
Focuses on trust boundaries, credential handling, catalog governance, private
repo assumptions, reproducibility, and operational failure modes. Prioritizes
risks that would block enterprise rollout.
```

Add `engineering-manager.md`, `agency-consultant.md`, and any other buyer or user you care about the same way.

## Running the reviews

Run the base agent once per persona document, naming the artifact under review:

```bash
outfitter run reviewer -- --print \
  "Adopt docs/user-personas/staff-engineer.md. Read README.md, \
   docs/getting-started.md, and docs/pricing.md, then return the standard \
   review shape: where the product feels credible, where it feels \
   underspecified, and the one example that would most improve your confidence."
```

```bash
outfitter run reviewer -- --print \
  "Adopt docs/user-personas/founder-operator.md. Browse the local docs site \
   and try the first-run setup flow. Report the first confusing moment, the \
   first moment that felt valuable, and whether you would keep using it."
```

Model and thinking choices — cheaper models for high-volume routing reviews, deeper reasoning for platform-risk reviews — live in the reviewer agent's loadout, or a machine-local override, rather than being duplicated per persona.

Because the base agent fixes the output shape, feedback from every persona document is directly comparable. The result is a reusable customer-persona review catalog that reads docs or experiences a UX from many viewpoints without pretending to replace real customer discovery.
