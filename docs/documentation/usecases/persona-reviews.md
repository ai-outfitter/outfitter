# Persona Reviews

A persona review catalog gathers structured feedback on a product, docs, onboarding flow, or UX from the points of view of the people who might use it — before asking real prospects to spend time. It uses the [persona convention](../personas.md): **one base review agent** plus a **directory of persona description documents**, run once per document.

See [`examples/persona-reviews`](../../../examples/persona-reviews/README.md) for a runnable catalog.

There is no `personas:` map and no agent per customer type. The review rules live in a single agent; each persona is a cheap markdown file you feed it as input.

```text
customer-review/                 # standalone .agents repo; root is the payload
  agents/
    reviewer/agent.md            # the base review agent
  settings.yml
docs/user-personas/
  roles/                         # reusable job archetypes (shared segment priorities)
    staff-engineer.md
    founder-operator.md
    platform-lead.md
  individuals/                   # specific named people, each naming one or more roles
    marcus-bell.md               # roles: [staff-engineer]
    dana-okafor.md               # roles: [founder-operator]
    priya-nair.md                # roles: [platform-lead]
```

Personas come in two kinds of file, and a review **mixes and matches** them: a **role** carries the priorities everyone in a customer segment shares, and an **individual** is one named person who inherits one or more roles and adds their own demographics and voice. Keep roles reusable and individuals concrete, and you can cover a lot of viewpoints from a small set of files.

## Settings

Settings only names the default agent and where resources resolve from — no persona list:

```yaml
# settings.yml
default_agent: reviewer
```

## The base review agent

One agent holds the review method and the output shape. It does not name any customer type; it reads the persona files it is told to adopt, in order.

```
<!-- agents/reviewer/agent.md -->
---
name: reviewer
description: Reviews an artifact from the point of view of an assigned customer persona.
---

Adopt the persona files named in your instructions, in order: a role file
establishes the segment's priorities, and an individual file layers that
person's demographics and voice on top (later files refine earlier ones). If
an individual names roles in its frontmatter, treat those as its baseline.

Read or experience the provided artifact from that persona's point of view:
docs, screenshots, website, prototype, product flow, or onboarding path.
Distinguish evidence from assumptions, cite the exact page or UI moment that
shaped your reaction, and do not invent real customer research.

Return feedback as: persona, artifact reviewed, first impression, top blocker,
strongest value signal, confusing language, suggested change, and confidence.
If you need more context, ask for the smallest missing artifact.
```

## Roles: reusable job archetypes

A role captures what everyone in a customer segment shares — the job, its goals, anxieties, buying triggers, and what its feedback focuses on — with no personal detail. Roles are reused across many individuals.

```
<!-- docs/user-personas/roles/staff-engineer.md -->
---
kind: role
title: Staff Engineer
segment: large-eng-org
goals: [reduce cross-team friction, raise technical quality, adopt tools that survive scrutiny]
anxieties: [tools that demo well but fail on a real codebase, unproven claims]
buying_triggers: [credible examples, verifiable outcomes, a clean migration path]
feedback_focus: [depth, verification paths, missing examples, evidence behind claims]
---

Responsible for large codebases, architecture decisions, reviews, and
cross-team technical quality. Cares whether the docs explain how the product
improves real engineering work. Flags missing examples, weak verification
paths, and claims that need evidence.
```

```
<!-- docs/user-personas/roles/founder-operator.md -->
---
kind: role
title: Founder-operator
segment: seed-stage-startup
goals: [ship weekly, keep the team small, reach the next milestone before the runway ends]
anxieties: [tool sprawl, hidden pricing, time lost to setup]
buying_triggers: [obvious value in the first hour, no credit card to try]
feedback_focus: [time-to-first-value, jargon, trust boundaries, pricing clarity]
---

A hands-on founder who writes product specs, edits docs, ships small features,
and manages a thin team. Cares whether the first hour feels obviously valuable.
```

## Individuals: named people who inherit roles

An individual is one concrete person — with the demographics a [Lean Canvas](https://leanstack.com/lean-canvas) customer segment gets — who names one or more roles to inherit and then adds their own attributes and voice. The named person **mixes and matches** roles: usually one, but a founder who also runs the platform can list both.

```
<!-- docs/user-personas/individuals/marcus-bell.md -->
---
kind: individual
name: Marcus Bell
roles: [staff-engineer]
born: 1985-11-02
location: Seattle, WA
household_income: 265000
education: MS Computer Engineering
employer: ~400-engineer fintech
hobbies: [rock climbing, sci-fi novels, restoring old synths]
skills: [distributed systems, code review, architecture, mentoring]
tone: dry, skeptical, cites sources
---

Reads new tooling the way he reads a design doc: looking for the failure mode
first. Warm once convinced, but will not take a benchmark on faith.
```

```
<!-- docs/user-personas/individuals/dana-okafor.md -->
---
kind: individual
name: Dana Okafor
roles: [founder-operator, platform-lead] # mixes two roles
born: 1989-03-14
location: Austin, TX
household_income: 180000
education: BS Computer Science
employer: 6-person seed-stage startup (also the de facto platform owner)
hobbies: [trail running, home espresso, mechanical keyboards]
skills: [product specs, TypeScript, fundraising, hiring]
tone: fast, pragmatic, allergic to jargon
---

Wears the founder and the platform hat at once, so she weighs first-hour value
against fleet-wide safety in the same breath. Impatient with setup friction.
```

Keep the role attribute set consistent so reviews stay comparable, and let individuals vary freely in demographics and tone. Add more roles (`platform-lead`, `engineering-manager`, `agency-consultant`) and more individuals the same way.

## Running the reviews

Run the base agent once per persona, naming the role and individual files to adopt and the artifact under review:

```bash
outfitter run reviewer -- --print \
  "Adopt docs/user-personas/roles/staff-engineer.md refined by \
   docs/user-personas/individuals/marcus-bell.md. Read README.md, \
   docs/getting-started.md, and docs/pricing.md, then return the standard \
   review shape: where the product feels credible, where it feels \
   underspecified, and the one example that would most improve your confidence."
```

```bash
outfitter run reviewer -- --print \
  "Adopt docs/user-personas/individuals/dana-okafor.md and the roles it names. \
   Browse the local docs site and try the first-run setup flow. Report the \
   first confusing moment, the first moment that felt valuable, and whether \
   you would keep using it."
```

Model and thinking choices — cheaper models for high-volume routing reviews, deeper reasoning for platform-risk reviews — live in the reviewer agent's loadout, or a machine-local override, rather than being duplicated per persona.

Because the base agent fixes the output shape, feedback from every persona document is directly comparable. The result is a reusable customer-persona review catalog that reads docs or experiences a UX from many viewpoints without pretending to replace real customer discovery.
