# Persona reviews

A persona review gathers structured feedback on a product, docs, onboarding flow, or UX from the point of view of the people who might use it — before asking real prospects to spend time. It uses the [persona convention](../personas.md): **one shared review agent** plus **one committed Markdown file per persona**. The same file runs under Outfitter, and pastes unchanged into any web agent.

## One persona, one file

The whole persona is one portable, self-contained Markdown document — a generic role archetype, H1 first, no frontmatter, first-person prose. Abridged from the canonical [`platform-lead.md`](https://github.com/ai-outfitter/community-profiles/blob/main/skills/persona-authoring/references/personas/platform-lead.md) reference:

```markdown
# Platform Lead

I'm the platform lead responsible for a consistent, reproducible agent setup
across a mid-sized engineering organization.

## How I decide

I look for clear precedence, pinned sources, documented secret boundaries,
least-privilege access, and tests showing that credentials stay isolated
between layers. I check the escape hatch first.
```

The review method lives in the shared [`persona-reviewer`](https://github.com/ai-outfitter/community-profiles/blob/main/agents/persona-reviewer/agent.md) agent; each persona is a Markdown file you append to it.

## Author it

Start from the community catalog's [`template.persona.md`](https://github.com/ai-outfitter/community-profiles/blob/main/skills/persona-authoring/assets/template.persona.md) by hand, or let any agent that selects the [`persona-authoring`](https://github.com/ai-outfitter/community-profiles/tree/main/skills/persona-authoring) skill interview you into the file. Commit the result to normal project documentation:

```text
docs/personas/
  platform-lead.md
  founder-operator.md
```

Prefer generic role archetypes over named individuals. Research and interviews are authoring inputs; commit only the self-contained file, and invent nothing the research does not support.

## Run it under Outfitter

Add the community catalog as a source and sync:

```yaml
# ~/.agents/settings.yml
sources:
  - github: ai-outfitter/community-profiles
    ref: <tag-or-commit>
```

Then launch the shared reviewer with the persona appended — directly, or via the `persona-review` skill's launcher:

```bash
bash skills/persona-review/scripts/persona-review.sh \
  --persona docs/personas/platform-lead.md \
  -- --print "Review the onboarding flow and write the report. @README.md"

# the launcher resolves the persona path and runs:
outfitter run persona-reviewer -- \
  --append-system-prompt docs/personas/platform-lead.md \
  --print "Review the onboarding flow and write the report. @README.md"
```

One shared agent adopts the file as its identity for that session only and writes a first-person, sourced report — evidence cited to the exact page or UI moment, assumptions labeled. The catalog agent pins a model (`openai-codex/gpt-5.5`); use the launcher's `--agent` flag to run another agent that selects this skill on whatever you have credentials for.

## Take the same file to the web

Paste or upload `docs/personas/platform-lead.md` unchanged into a claude.ai project's knowledge or a ChatGPT project and say: "Treat this as stakeholder context. Review the attached landing page from this persona's point of view." The file was written to read standalone, so a tool that takes Markdown project context can use it unchanged.

## Why this shape

- **One file per persona**: adding a persona adds a document, not another agent.
- **Comparable reports**: one agent fixes the review method and output shape, so feedback from different persona files is directly comparable.
- **No Outfitter dependency**: Outfitter is one optional consumer of a file that does not depend on it.

See the [persona spec](../personas.md) for the format, and the community catalog's [persona boundary doc](https://github.com/ai-outfitter/community-profiles/blob/main/docs/persona-review.md) for the responsibility split between authoring, the shared reviewer, and project wrappers.
