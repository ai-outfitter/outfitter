# Personas

A persona is not a resource or a settings key — it is a **convention** built from two ordinary pieces:

1. A **base review agent** — a normal [agent](./agents.md) whose prompt says how to review something (an app, docs, a UX flow): what to look at, what evidence to cite, what output shape to return.
2. An interchangeable **persona description document** — a plain markdown file, for example `docs/user-personas/coyote-road-runner-chaser.md`, describing one person's role, goals, anxieties, and vantage point.

You run the base agent and feed it one persona document as input. Swapping the document swaps the persona; the base agent — the review rules — stays fixed. Nothing new is added to the protocol: it is one agent plus a folder of description files.

```text
customer-review/
  agents/
    reviewer/agent.md          # base: how to review, what to return
  settings.yml
docs/user-personas/
  founder-operator.md          # persona description documents
  staff-engineer.md
  platform-lead.md
```

## Why a convention, not a key

Modeling personas as their own resource — or as a `personas:` list you compose in order — duplicates what an agent already is and grows the surface area of the system. Agents are exactly what that machinery was reaching for. Keeping personas as "base agent + description document" means a team maintains one review agent and a directory of cheap markdown files, instead of a fleet of near-identical agents.

## Running a persona review

Point the base agent at the artifact and name the persona document to adopt:

```bash
outfitter run reviewer -- --print \
  "Adopt docs/user-personas/founder-operator.md. Review README.md and \
   docs/getting-started.md and return the standard review shape."
```

Because the base agent fixes the output shape, feedback from different persona documents stays directly comparable.

See [Persona reviews](./usecases/persona-reviews.md) for a complete catalog example.
