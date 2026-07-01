# Engineering Profile Catalog

An engineering profile catalog is a shared setup source for people who write code, review changes, operate infrastructure, and debug production-like systems. It gives engineers a reliable default Pi session without asking each teammate to rebuild the same model, thinking, prompt, skill, and extension choices by hand.

For example, `acme-engineering-outfitter` can publish a small catalog with profiles for day-to-day implementation, deeper platform work, and lightweight review or triage.

```text
acme-engineering-outfitter/
  settings.yml
  profiles/
    base-engineering/
      profile.yml
    engineer/
      profile.yml
    platform-engineer/
      profile.yml
    reviewer/
      profile.yml
```

## Catalog settings

```yaml
# acme-engineering-outfitter/settings.yml
profile_sources:
  - path: ./profiles
    only:
      - engineer
      - platform-engineer
      - reviewer
```

## Shared base profile

```yaml
# profiles/base-engineering/profile.yml
id: base-engineering
label: Engineering Base
template: true
description: Shared engineering operating rules for code, tests, and infrastructure.
controls:
  append_system_prompt: |
    Work as a careful engineering agent. Read the relevant code before editing,
    prefer small reversible changes, keep secrets out of logs, run focused tests,
    and return changed files plus verification evidence.
```

## Role profiles

Engineering catalogs SHOULD separate routine implementation from high-risk infrastructure and review work. The examples below are role-shaped; replace model IDs and thinking levels with the exact choices exposed by the team's agent providers.

```yaml
# profiles/engineer/profile.yml
id: engineer
label: Software Engineer
description: Default for feature work, bug fixes, and test-backed implementation.
inherits:
  - base-engineering
controls:
  provider: anthropic
  model: anthropic/claude-sonnet-4
  thinking: high
  append_system_prompt: |
    Optimize for correct, reviewable implementation. Inspect nearby code and tests,
    make narrow commits, run the smallest meaningful validation, and summarize risks.
```

```yaml
# profiles/platform-engineer/profile.yml
id: platform-engineer
label: Platform Engineer
description: Higher-caution profile for CI, infrastructure, deployment, and incident work.
inherits:
  - base-engineering
controls:
  provider: anthropic
  model: anthropic/claude-opus-4
  thinking: xhigh
  append_system_prompt: |
    Treat infrastructure and production-like systems as high-risk. Diagnose before
    mutating state, name rollback paths, and ask before deploys, credential use,
    payments, or irreversible operations.
```

```yaml
# profiles/reviewer/profile.yml
id: reviewer
label: Code Reviewer
description: Review-focused profile for diffs, pull requests, and release readiness.
inherits:
  - base-engineering
controls:
  provider: openai
  model: openai/gpt-4.1
  thinking: medium
  append_system_prompt: |
    Review for correctness, regression risk, missing tests, unsafe operations,
    unclear rollout paths, and documentation drift. Prioritize actionable findings
    over style nits.
```

## Verification pattern

Engineering catalogs SHOULD make verification expectations explicit in prompts or comments so agents return evidence instead of vague completion claims.

```yaml
# profiles/engineer/profile.yml excerpt
controls:
  append_system_prompt: |
    When you change code, report the exact tests or checks you ran. If a check is
    skipped, say why and name the smallest follow-up validation that would reduce risk.
```

This gives an engineering team a repeatable catalog with safe defaults: fast enough for common implementation, cautious enough for infrastructure, and explicit about verification evidence.
