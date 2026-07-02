# Organization Profile Catalog

An organization profile catalog is a shared setup source that publishes named roles instead of asking every user to choose providers, models, thinking levels, extensions, and prompts by hand.
For example, `acme` can publish a small catalog that gives engineers, platform operators, support staff, and executives a useful default Pi session while still letting projects override the final profile.

```text
acme-outfitter-catalog/
  settings.yml
  profiles/
    base-acme/
      profile.yml
    engineer/
      profile.yml
    platform-operator/
      profile.yml
    support-triage/
      profile.yml
    exec-briefing/
      profile.yml
```

## Catalog settings

```yaml
# acme-outfitter-catalog/settings.yml
profile_sources:
  - path: ./profiles
```

The base profile below is marked `template: true`, so role profiles can inherit it while it never appears as a launchable choice. Avoid `only:` filters that omit an inherited base profile — filtered-out profiles are not loaded at all, so inheritance from them fails.

## Shared base profile

```yaml
# profiles/base-acme/profile.yml
id: base-acme
label: Acme Base
template: true
description: Shared Acme operating rules for every published role.
controls:
  append_system_prompt: |
    Work as an Acme operator: prefer small reversible changes, cite durable evidence,
    keep secrets out of logs and docs, and write decisions into repository files.
```

## Role profiles

The catalog SHOULD publish role profiles that make the cost/latency/quality tradeoff explicit.
Use provider-qualified model IDs that match the models available in the team's Pi or Claude configuration.
The examples below are intentionally role-shaped; replace model IDs with the exact names exposed by the organization's provider catalog.

```yaml
# profiles/engineer/profile.yml
id: engineer
label: Software Engineer
description: Default for feature work, debugging, tests, and code review.
inherits:
  - base-acme
controls:
  provider: anthropic
  model: anthropic/claude-sonnet-4
  thinking: high
  append_system_prompt: |
    Optimize for correct implementation over speed. Read nearby code before editing,
    run the narrowest meaningful tests, and return changed files plus verification.
```

```yaml
# profiles/platform-operator/profile.yml
id: platform-operator
label: Platform Operator
description: Higher-reasoning profile for infrastructure, incidents, CI, and release safety.
inherits:
  - base-acme
controls:
  provider: anthropic
  model: anthropic/claude-opus-4
  thinking: xhigh
  append_system_prompt: |
    Treat production-like systems as high-risk. Prefer diagnosis before mutation,
    name rollback paths, and ask before deploys, credential use, payments, or irreversible changes.
```

```yaml
# profiles/support-triage/profile.yml
id: support-triage
label: Support Triage
description: Lower-cost profile for ticket summarization, reproduction notes, and routing.
inherits:
  - base-acme
controls:
  provider: openai
  model: openai/gpt-4.1-mini
  thinking: low
  append_system_prompt: |
    Convert messy user reports into concise reproduction steps, affected surfaces,
    suspected owners, and the next question that would unblock diagnosis.
```

```yaml
# profiles/exec-briefing/profile.yml
id: exec-briefing
label: Executive Briefing
description: Fast profile for dense status synthesis and decision memos.
inherits:
  - base-acme
controls:
  provider: openai
  model: openai/gpt-4.1
  thinking: medium
  append_system_prompt: |
    Produce dense prose for leaders: state the decision, evidence, risk, owner,
    deadline, and the smallest reversible next action. Avoid implementation trivia unless it changes the decision.
```

## Budget annotation pattern

Profiles can carry comments that explain why a role uses a given model and thinking level without embedding current vendor prices.
Keep the metric relative, because token prices and model names drift.

```yaml
# Metric docstring for catalog maintainers:
# budget_units estimates relative spend and latency for a role, not an invoice.
# budget_units = expected_input_tokens * input_weight
#              + expected_output_tokens * output_weight
#              + expected_reasoning_tokens * thinking_weight
# thinking_weight guideline: low=1, medium=2, high=4, xhigh=8.
# Use low/medium for repeatable summarization or routing; use high/xhigh when a wrong answer
# can cause rework, outages, bad code, unsafe operations, or expensive human review.

# profiles/platform-operator/profile.yml excerpt
controls:
  model: anthropic/claude-opus-4
  thinking: xhigh # Expensive by design: infra mistakes dominate token spend.
```

This gives the organization a publishable catalog with clear defaults: cheaper profiles for high-volume low-risk work, stronger reasoning for code and infrastructure, and role prompts that teach the agent what evidence and output shape matter for each job.

## Scaling context across many codebases

When the organization has many repositories and teams, keep role prompts thin and move codebase, team, and policy context into a governed prompts library that profiles compose per role. See [Federated context](../federated-context.md) for the pattern and a runnable example.
