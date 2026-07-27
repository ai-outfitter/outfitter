# Personas

A persona is not a resource or a settings key — it is a **convention** built from ordinary pieces:

1. A **shared review agent** — [`persona-reviewer`](https://github.com/ai-outfitter/community-profiles/blob/main/agents/persona-reviewer/agent.md), a normal [agent](./agents.md) from the community catalog whose prompt says how to review something and what a sourced report looks like. There is one reviewer for all personas, never one agent per persona.
2. **One committed Markdown file per persona** — a portable, self-contained document. The whole persona lives in that one file; swapping the file swaps the persona, and the review rules stay fixed.

## The format

A persona file is plain Markdown with no frontmatter, no schema, and no classifier:

- Starts directly with an H1 naming a **generic role archetype**: `# Platform Lead`, `# Founder-operator`. (A named individual — `# Priya Nair — Platform Lead` — is an optional variant for when a specific person's voice is the point; the generic form is canonical.)
- First-person prose: an unheaded opening paragraph that stands alone as an introduction, then the recommended sections `## My work and context`, `## What I need`, `## How I decide`, and `## How I communicate`. Sections may be renamed or combined; connected prose beats bullet stacks.
- Everything the persona knows — role, organization, goals, concerns, constraints, decision signals, voice — is ordinary Markdown a human would read.

It lives in normal project documentation, deliberately **outside** `.agents/`:

```text
docs/personas/
  platform-lead.md
  founder-operator.md
```

A persona is project steering context, not agent configuration — which is why `outfitter dump` does not carry it, by design. The executable artifacts of this format — an authoring template and completed reference personas — ship in the community catalog's [`persona-authoring`](https://github.com/ai-outfitter/community-profiles/tree/main/skills/persona-authoring) skill.

## Three ways to consume the same file

- **Appended at launch**: `outfitter run persona-reviewer -- --append-system-prompt docs/personas/platform-lead.md …`, or the [`persona-review`](https://github.com/ai-outfitter/community-profiles/tree/main/skills/persona-review) skill's launcher script that wraps it. The reviewer adopts the file as its identity for that session only.
- **Pasted into a web agent**: upload or paste the file unchanged into claude.ai project knowledge or a ChatGPT project as stakeholder context. Same artifact, zero conversion.
- **Ordinary reading context**: any agent doing product planning, research, or writing can read the file to know who the work is for.

## Why a convention, not a key

Modeling personas as their own resource — or as a `personas:` list you compose in order — duplicates what an agent already is and grows the surface area of the system. Keeping personas as "shared agent + one document" means a team maintains one review agent and a directory of cheap Markdown files, instead of a fleet of near-identical agents or a runtime chain of fragments.

Organization research, interviews, and individual detail are **authoring inputs**, not committed schema: interview from them, keep research notes however you like, but the committed canonical artifact is always one self-contained role file. Do not invent demographics, income, or biography the research does not support, and never generate an Outfitter agent per persona.

## Status

Personas ride entirely on existing CLI behavior (`outfitter run` plus `--append-system-prompt` passthrough), so no `OFTR-*` requirement covers them — they are a documentation convention, not shipped surface. An `.agents`-native persona form (a protocol resource, or a settings layer pointing at persona documents) is a separate, deferred design; the portable file must never depend on it.

See [Persona reviews](./usecases/persona-reviews.md) for the worked author → run → paste-anywhere story, and the community catalog's [persona boundary doc](https://github.com/ai-outfitter/community-profiles/blob/main/docs/persona-review.md) for the setup and runtime responsibility split.
