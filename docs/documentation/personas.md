# Personas

A persona is not a resource or a settings key — it is a convention built from ordinary pieces:

1. A **shared review agent** — [`persona-reviewer`](https://github.com/ai-outfitter/community-profiles/blob/main/agents/persona-reviewer/agent.md), a normal [agent](./agents.md) from the community catalog that selects the `persona-review` skill, which owns the review method and report shape. One reviewer serves all personas.
2. **One committed Markdown file per persona** — a portable, self-contained document. The whole persona lives in that one file; swapping the file swaps the persona, and the review rules stay fixed.

## The format

A persona file is plain Markdown with no frontmatter and no schema:

- Starts directly with an H1 naming a **generic role archetype**: `# Platform Lead`, `# Founder-operator`. Use a named individual (`# Priya Nair — Platform Lead`) only when a specific person's voice is the point.
- First-person prose: an unheaded opening paragraph, then the recommended sections `## My work and context`, `## What I need`, `## How I decide`, and `## How I communicate`. Sections may be renamed or combined; connected prose beats bullet stacks.
- Everything the persona knows — role, goals, constraints, decision signals, voice — is ordinary Markdown.

The authoring template and completed reference personas ship in the community catalog's [`persona-authoring`](https://github.com/ai-outfitter/community-profiles/tree/main/skills/persona-authoring) skill.

## Where personas live

A persona file lives in normal documentation, deliberately outside `.agents/`, in one of two tiers:

```text
docs/personas/            # project tier — readers of this project
  platform-lead.md
~/.agents/personas/       # cross-project tier — readers who outlive one repository
  founder-operator.md
```

Use the **project tier** when the persona only makes sense next to the work it describes. Use the **cross-project tier** when the reader exists independently of any single repository — the file is then reachable from any working directory, including `~`. Filenames are lowercase and hyphenated and name the role rather than the person.

Neither tier is a resource Outfitter resolves; both are ordinary directories of Markdown. A persona is project steering context rather than agent configuration, which is why `outfitter dump` does not carry it. The `persona-review` launcher searches the project tier before the cross-project one, so `--persona platform-lead` picks up a project override of a shared role without renaming anything.

## Three ways to consume the same file

- **Appended at launch**: `outfitter run persona-reviewer --append-prompt docs/personas/platform-lead.md -- …` — the direct run is the underlying interface, and the reviewer adopts the file as its identity for that session only. Pass `--append-prompt` rather than spelling the harness flag yourself after `--`: pi and Claude Code take append-prompt documents through different native flags. Codex has no native append flag yet, so its adapter warns that the document is dropped. An agent using the [`persona-review`](https://github.com/ai-outfitter/community-profiles/tree/main/skills/persona-review) skill can drive the same run in the background or synchronously and capture its report in a durable file. See [Persona reviews](./usecases/persona-reviews.md) for the runnable form of both supported identity projections.
- **Pasted into a web agent**: upload or paste the file unchanged into claude.ai project knowledge or a ChatGPT project as stakeholder context. Same artifact, zero conversion.
- **Ordinary reading context**: any agent doing product planning, research, or writing can read the file to know who the work is for.

## When one file is not enough

Start with one file. Reach for a second only when part of an identity varies independently and would otherwise be copied into every persona that shares it — most often an **organization**: sector, scale, regulatory exposure, how the business weighs risk against speed. Three organizations against four roles is seven documents rather than twelve.

```sh
outfitter run persona-reviewer \
  --append-prompt docs/personas/org.enterprise-insurance.md \
  --append-prompt docs/personas/platform-lead.md \
  -- --print "Review the onboarding flow. @README.md"
```

Order is meaning: earlier documents establish the context later ones are read against, so organization comes before role, and a named individual comes last. A role document written for composition must not name a sector or an employer — that is exactly what lets it read correctly under any organization.

Each file is still ordinary Markdown that reads on its own, names no other file, and leaves no placeholder for one. Splitting for any other reason — to store a schema in filenames, to make files shorter, to mirror a template — is the failure mode the next section describes, and it remains the wrong move.

Portability survives intact. Every document uploads unchanged into claude.ai project knowledge or a ChatGPT project; when an identity spans several, upload them in the same order, or `cat org.md role.md > persona.md` and upload the one file. The claim was never _one artifact_ — it is _no conversion step_, and `cat` is not a conversion step.

## Why a convention, not a key

Modeling personas as their own resource — a `personas:` key that Outfitter resolves, merges across layers, validates, and projects — duplicates what an agent already is and grows the surface area of the system. Naming documents at launch is not that: Outfitter resolves nothing, merges nothing, validates nothing, and `outfitter dump` still carries no persona. Order is whatever you typed on the command line, not a precedence rule the system has to define and defend.

Keeping personas as "shared agent plus committed Markdown" means a team maintains one review agent and a directory of cheap files, instead of a fleet of near-identical agents. A tenth persona is a tenth file; a second organization is one more file, not a copy of every role.

Organization research, interviews, and individual detail are **authoring inputs**, not committed schema: interview from them, keep research notes however you like, but what gets committed is Markdown a person can read. Do not invent demographics, income, or biography the research does not support, and never generate an Outfitter agent per persona.

## Status

Personas ride entirely on existing CLI behavior — `outfitter run` plus `--append-prompt`, which projects each document through whichever flag the selected harness actually reads — so no `OFTR-*` requirement covers them beyond the composition order in `OFTR-005.3.1`. The reviewer runs as the selected agent; native Pi subagent projection is not a prerequisite. An `.agents`-native persona form (a protocol resource, or a settings layer pointing at persona documents) is a separate, deferred design; the portable file must never depend on it.

See [Persona reviews](./usecases/persona-reviews.md) for the worked author → run → paste-anywhere story, and the community catalog's [persona boundary doc](https://github.com/ai-outfitter/community-profiles/blob/main/docs/persona-review.md) for the setup and runtime responsibility split.
