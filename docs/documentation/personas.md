# Personas

A persona is not a resource or a settings key — it is a convention built from ordinary pieces:

1. A **shared review agent** — [`persona-reviewer`](https://github.com/ai-outfitter/community-profiles/blob/main/agents/persona-reviewer/agent.md), a normal [agent](./agents.md) from the community catalog that selects the `persona-review` skill, which owns the review method and report shape. One reviewer serves all personas.
2. **One committed Markdown file per persona** — a portable, self-contained document. The whole persona lives in that one file; swapping the file swaps the persona, and the review rules stay fixed.

## The format

A persona file is plain Markdown with no frontmatter and no schema:

- Starts directly with an H1 naming a **generic role archetype**: `# Platform Lead`, `# Founder-operator`. Use a named individual (`# Priya Nair — Platform Lead`) only when a specific person's voice is the point.
- First-person prose: an unheaded opening paragraph, then the recommended sections `## My work and context`, `## What I need`, `## How I decide`, and `## How I communicate`. Sections may be renamed or combined; connected prose beats bullet stacks.
- Everything the persona knows — role, goals, constraints, decision signals, voice — is ordinary Markdown.

It lives in normal project documentation, deliberately outside `.agents/`:

```text
docs/personas/
  platform-lead.md
  founder-operator.md
```

A persona is project steering context rather than agent configuration, which is why `outfitter dump` does not carry it. The authoring template and completed reference personas ship in the community catalog's [`persona-authoring`](https://github.com/ai-outfitter/community-profiles/tree/main/skills/persona-authoring) skill.

## Three ways to consume the same file

- **Appended at launch**: `outfitter run persona-reviewer -- --append-system-prompt docs/personas/platform-lead.md …` — the direct run is the underlying interface, and the reviewer adopts the file as its identity for that session only. An agent using the [`persona-review`](https://github.com/ai-outfitter/community-profiles/tree/main/skills/persona-review) skill can drive the same run in the background or synchronously and capture its report in a durable file. See [Persona reviews](./usecases/persona-reviews.md) for the runnable form of both.
- **Pasted into a web agent**: upload or paste the file unchanged into claude.ai project knowledge or a ChatGPT project as stakeholder context. Same artifact, zero conversion.
- **Ordinary reading context**: any agent doing product planning, research, or writing can read the file to know who the work is for.

## Why a convention, not a key

Modeling personas as their own resource — or as a `personas:` list you compose in order — duplicates what an agent already is and grows the surface area of the system. Keeping personas as "shared agent + one document" means a team maintains one review agent and a directory of cheap Markdown files, instead of a fleet of near-identical agents or a runtime chain of fragments.

Organization research, interviews, and individual detail are **authoring inputs**, not committed schema: interview from them, keep research notes however you like, but the committed canonical artifact is always one self-contained role file. Do not invent demographics, income, or biography the research does not support, and never generate an Outfitter agent per persona.

## Status

Personas ride entirely on existing CLI behavior (`outfitter run` plus `--append-system-prompt` passthrough), so no `OFTR-*` requirement covers them. The reviewer runs as the selected agent; native Pi subagent projection is not a prerequisite. An `.agents`-native persona form (a protocol resource, or a settings layer pointing at persona documents) is a separate, deferred design; the portable file must never depend on it.

See [Persona reviews](./usecases/persona-reviews.md) for the worked author → run → paste-anywhere story, and the community catalog's [persona boundary doc](https://github.com/ai-outfitter/community-profiles/blob/main/docs/persona-review.md) for the setup and runtime responsibility split.
