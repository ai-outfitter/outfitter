# Persona Reviews

Persona reviews use Outfitter profiles to launch bounded reviewer agents that represent a specific audience, customer, stakeholder, or expert lens. They are useful when a change needs feedback from more than the authoring engineer but does not need a full open-ended agent session for every reviewer.

Use persona reviews to ask focused questions such as:

- Would a first-time founder understand this onboarding flow?
- Does this pricing copy answer the buyer's objections?
- Would a security reviewer object to the documented deployment path?
- Does the support persona have enough information to triage a customer report?

The goal is not to make a persona the final decision-maker. The goal is to collect structured, repeatable feedback from named viewpoints before a human merges, ships, or escalates the work.

## When persona reviews help

Persona reviewers work best for bounded review tasks:

- reviewing documentation, release notes, onboarding flows, and product copy;
- checking whether a pull request explains risks and verification clearly;
- testing whether a workflow serves a named user segment;
- collecting go/no-go concerns from product, support, security, or founder viewpoints;
- comparing a proposed change against project-local mission, requirements, or customer context.

Avoid using personas as unbounded implementers. A persona reviewer SHOULD receive a narrow review brief, inspect only the relevant files or diff, and return findings with evidence. If a finding requires code or document changes, route that work back to an implementation profile.

## Store personas as a profile source

A project can keep persona profiles in a dedicated flat profile source under `.outfitter/personas`. This convention keeps reviewer profiles separate from day-to-day engineering launch profiles while still using the same Outfitter profile loading and inheritance rules.

```text
.outfitter/
  settings.yml
  personas/
    base.yml
    first-time-founder.yml
```

Add the persona source to project settings when the project wants Outfitter to resolve those profiles by ID:

```yaml
# .outfitter/settings.yml
profile_sources:
  - path: ./profiles
  - path: ./personas
```

The `./personas` path is relative to `.outfitter/settings.yml`. A flat source is appropriate when each file is one complete profile. Use profile folders with `profile.yml` only when a persona owns additional files beside its profile.

## Example persona profiles

Start with a shared persona base profile that defines the review contract. Mark it as a template so people do not launch it directly by accident. Keep the runnable persona-specific context in each inheriting profile. Document both files together when explaining the convention:

```yaml
# .outfitter/personas/base.yml
id: base
template: true
label: Persona Base
description: Shared contract for generated customer/user persona subagents.
agent_generation: true
controls:
  pi:
    append_system_prompt: |
      You are acting as a customer/user persona running as a delegated Pi subagent.
      Review only from the persona viewpoint supplied by the runnable persona profile.
      Cite evidence, separate assumptions from known facts, and do not invent customer details.
---
# .outfitter/personas/first-time-founder.yml
id: first-time-founder
label: First-time Founder
description: Reviews whether product and documentation changes are clear to a founder adopting Outfitter for the first time.
inherits:
  - base
controls:
  pi:
    # this could be append_system_prompt: file:docs/personas/first-time-founder.md
    append_system_prompt: |
      You are Maya Chen, the First-time Founder persona.
      Maya is a 34-year-old woman with a bachelor's degree in business administration, a spouse and one young child, and a household income of about $145,000 before taxes.
      She is building her first software-enabled services company while handling sales, hiring, fundraising, and light product work herself.
      Before starting substantive work, read and follow docs/personas/first-time-founder.md.
      Apply Maya's job-to-be-done, constraints, vocabulary, family/time pressure, budget sensitivity, and success criteria.
```

Additional personas can model buyers, maintainers, enterprise admins, support engineers, security reviewers, or any other named audience. Keep each persona small enough that its feedback is predictable and easy to compare across changes.

## Run personas as generated subagents

Persona profiles are most useful when an orchestrating agent launches them as generated subagents for a narrow review. A typical workflow is:

1. The primary engineering or writing agent prepares a docs or code change.
2. The orchestrator selects one or more persona profiles from `.outfitter/personas`.
3. Each persona subagent receives the same bounded review brief, such as "review `docs/documentation/usecases/persona-reviews.md` for first-time-founder clarity; do not edit files."
4. Persona subagents return findings, evidence, and readiness notes.
5. The primary agent decides which findings to address, makes any changes, and records remaining caveats.

Keep persona prompts explicit about scope and authority. A good persona review brief names the files, the audience question, the expected output shape, and whether the persona may suggest changes or only identify concerns.

Example review brief:

```text
Use the first-time-founder persona to review docs/documentation/getting-started.md.
Do not edit files. Focus on whether a founder can understand the value, install path,
first successful run, and rollback options. Return blockers, non-blocking improvements,
and one paragraph on whether the page is ready to publish for this audience.
```

## Review output pattern

Ask persona reviewers for structured output so their feedback can be merged with other review signals:

```text
Readiness: ready | ready-with-caveats | not-ready
Audience lens: <persona id and one-line interpretation>
Findings:
- Severity: blocker | major | minor | polish
  Evidence: <file, heading, quote, or diff hunk>
  Concern: <what this persona would misunderstand or object to>
  Suggested resolution: <smallest useful change or follow-up question>
Strongest positive signal: <what works well for this persona>
```

This keeps persona reviews actionable without letting them expand into open-ended product strategy or implementation work.

## Maintenance guidelines

- Keep persona profiles versioned with the project context they review.
- Prefer inheritance from a shared base profile instead of repeating review rules in every persona.
- Keep examples flat unless a persona needs bundled prompt files or artifacts.
- Revisit personas when the product audience, pricing, compliance posture, or support motion changes.
- Treat persona output as advisory evidence. Human owners still decide what ships.
