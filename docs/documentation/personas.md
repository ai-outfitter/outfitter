# Personas

A persona is not a resource or a settings key — it is a **convention** built from ordinary pieces:

1. A **base review agent** — a normal [agent](./agents.md) whose prompt says how to review something (an app, docs, a UX flow): what to look at, what evidence to cite, what output shape to return.
2. Interchangeable **persona description documents** — plain markdown files with attributes in frontmatter and a short bio underneath. They come in two kinds you **mix and match**: a **role** (a reusable job archetype — goals, anxieties, buying triggers shared across a customer segment) and an **individual** (a named person with demographics — birthdate, income, education, hobbies, skills — who inherits one or more roles and adds their own voice). Give each the concreteness a [Lean Canvas](https://leanstack.com/lean-canvas) customer segment gets.

You run the base agent and feed it the persona files to adopt: a role, refined by an individual. Swapping the files swaps the persona; the base agent — the review rules — stays fixed. Nothing new is added to the protocol: it is one agent plus a folder of description files. See [Persona reviews](./usecases/persona-reviews.md) for the full shape.

```text
customer-review/
  agents/
    reviewer/agent.md          # base: how to review, what to return
  settings.yml
docs/user-personas/
  roles/                       # reusable job archetypes
    staff-engineer.md
    founder-operator.md
  individuals/                 # named people, each naming one or more roles
    marcus-bell.md
    dana-okafor.md
```

## Why a convention, not a key

Modeling personas as their own resource — or as a `personas:` list you compose in order — duplicates what an agent already is and grows the surface area of the system. Agents are exactly what that machinery was reaching for. Keeping personas as "base agent + description document" means a team maintains one review agent and a directory of cheap markdown files, instead of a fleet of near-identical agents.

## Running a persona review

Point the base agent at the artifact and name the persona files to adopt — a role refined by an individual:

```bash
outfitter run reviewer -- --print \
  "Adopt docs/user-personas/roles/founder-operator.md refined by \
   docs/user-personas/individuals/dana-okafor.md. Review README.md and \
   docs/getting-started.md and return the standard review shape."
```

Because the base agent fixes the output shape, feedback from different persona documents stays directly comparable.

See [Persona reviews](./usecases/persona-reviews.md) for a complete catalog example.
