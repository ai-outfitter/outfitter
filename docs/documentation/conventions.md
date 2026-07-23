# Conventions

A resource that "belongs everywhere" is a _placement_ problem, not a duplication problem. This page names the convention that keeps a growing `.agents` ecosystem from collapsing into copies: **place a resource once, specialize downward, never copy.**

The mechanisms already exist — layer inheritance, merge-by-ID overrides, [loadout-added references](./skills.md#loadout-added-references), and progressive disclosure. The convention is agreeing to use them in order:

1. **Author once at the most general layer where the resource is true**, then let lower layers inherit it.
2. **Specialize downward** via same-ID overrides and loadout-added references, instead of forking or copying.
3. **Split by whether the agent should _decide_.** Ambient rules an agent should never think about belong in always-on shared context; situational capabilities belong in [skills](./skills.md), where progressive disclosure keeps them to roughly one line of context until they activate.

## Layer homes

Each layer inherits the one above it. ID-addressed resources — agents, skills, knowledge — merge and override by ID; root shared context (`agents.md` / `system-prompt.md`) is selected whole-file by layer precedence (see the [roadmap note](#roadmap-a-shareable-prompt-fragment) below):

| Layer            | Location                                                                      | Holds                                                                                       |
| ---------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Community        | e.g. `ai-outfitter/community-profiles`                                        | Reviewed building blocks — skills and reference agents anyone can mix and match.            |
| Curated defaults | e.g. `ai-outfitter/default-profiles`                                          | The pinned, curated assembly — starter agents users adopt as-is.                            |
| Organization     | `owner/.outfitter` [control repo](./usecases/organization-profile-catalog.md) | Bespoke org agents, shared `agents.md`, org-specific skills (brand voice, RBAC, endpoints). |
| User / project   | `~/.agents`, `<repo>/.agents`                                                 | Personal and repo overrides, loadout-added references, same-ID resource overrides.          |

Generalized: **community publishes the parts, curated catalogs pin an assembly, org and project bind values and override by ID.**

## Where each kind of rule lives

| Rule type                                                                             | Home                                                                             | Agent decides?     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------ |
| Ambient, always-true (conventional commits, secret hygiene, small reversible changes) | Shared context: the tree's `agents.md` / `system-prompt.md`, inherited per layer | Never              |
| Situational capability or procedure (release notes, incident response, SEO audit)     | A [skill](./skills.md) selected by slug (progressive disclosure)                 | Yes, on activation |
| Mechanically checkable (commit format, lint, formatting)                              | A [hook](./hooks.md) or CI check, plus the one-line ambient rule                 | Never              |

The first row is the one teams get wrong most often: an ambient rule made into a skill forces every agent to _notice and choose_ it, and an ambient rule pasted into every `agent.md` becomes N drifting copies. Keep it in shared context, once, at the highest layer where it holds. When a selected skill already defines a capability, an agent definition MUST NOT copy or paraphrase it — the [skills doc](./skills.md#where-context-and-instructions-live) draws the same boundary.

## Worked example: conventional commits

Conventional commits "belongs in every profile" — the engineer, the marketing agent that occasionally commits copy, the CI bot — yet must never be pasted into every profile. It is the canonical ambient rule:

- **Author once** — one line in the shared `agents.md` of the highest layer where it holds (the org tree, or your `~/.agents/system-prompt.md` for everything on one machine).
- **Inherit downward** — every agent composed from that tree carries the rule with zero per-agent cost and no activation decision.
- **Override downward** — a project with a different commit convention ships its own shared context in `<repo>/.agents/`; workspace precedence wins. Today the root file wins _whole_, not line by line — fragment-level override is the [roadmap primitive](#roadmap-a-shareable-prompt-fragment) — so keep shared context lean enough that a deliberate replacement stays cheap and reviewable.
- **Enforce deterministically** — a `commit-msg` hook or release tooling is the backstop; the ambient line keeps the model writing them right the first time.

The full story, including projection into native harness files, is the [Shared conventions use case](./usecases/shared-conventions.md).

## Worked example: a role profile

The same convention builds a role-scoped profile — a `platform` or `marketing` agent ([#197](https://github.com/ai-outfitter/outfitter/issues/197)):

- **Inherit the shared baseline** (the tree's `agents.md`), then add role skills on top — `brand-voice`, `content-drafting`, `seo-audit` for marketing; provisioning and observability skills for platform. _Few agents, many skills_ ([Best practices](./best-practices.md)).
- **Bespoke per org two ways:** as a [subagent](./subagents.md) other agents delegate role work to, or via one org-specific skill (a `brand` or `platform` skill) carrying the values — endpoints, voice, RBAC — that make the shared profile bespoke without duplicating it.
- **Role separation is the point.** An engineer or a marketer doesn't want the other's machinery in context; they work expeditiously in their own lane and delegate across lanes when needed. Cross-cutting work stays _available_ through inheritance and delegation, not by stuffing every profile.

## Roadmap: a shareable prompt fragment

Today the always-on vehicle is a tree's root `agents.md` / `system-prompt.md` — one file per layer. It inherits and overrides _per layer_, but you cannot yet publish one named fragment from a community catalog and override just that fragment by ID. A first-class, slug-composable shared prompt fragment is the missing primitive; until it lands, a single line per layer's shared context still deduplicates by inheritance — just not as a publishable unit. [Hooks](./hooks.md) carry the analogous gap for portable hook definitions.
