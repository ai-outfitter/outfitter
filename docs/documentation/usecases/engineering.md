# Engineering Catalog

An engineering catalog is a shared `.agents` source for people who write code, review changes, operate infrastructure, and debug production-like systems. It gives engineers a reliable default session without asking each teammate to rebuild the same model, prompt, skill, and persona choices by hand.

For example, `acme-engineering/.agent` can publish a small catalog with roles for day-to-day implementation, deeper platform work, and lightweight review or triage — plus the skills those roles share.

```text
acme-engineering/.agent/     # repository root is the payload
  agents/
    base-engineering/agent.md
    engineer/agent.md
    platform-engineer/agent.md
    reviewer/agent.md
  skills/
    issue-planning/
    deployment-review/
  settings.yml
```

## Catalog settings

```yaml
# settings.yml
profiles:
  engineer:
    personas: [base-engineering, engineer]
    skills: [issue-planning]
  platform-engineer:
    personas: [base-engineering, platform-engineer]
    skills: [deployment-review]
  reviewer:
    personas: [base-engineering, reviewer]
```

## Shared base persona

```markdown
<!-- agents/base-engineering/agent.md -->
---
name: base-engineering
description: Shared engineering operating rules for code, tests, and infrastructure.
---

Work as a careful engineering agent. Read the relevant code before editing,
prefer small reversible changes, keep secrets out of logs, run focused tests,
and return changed files plus verification evidence.
```

## Role personas

Engineering catalogs SHOULD separate routine implementation from high-risk infrastructure and review work. Model and thinking choices live in each agent's `config.json`; replace the IDs with the exact choices exposed by the team's providers.

```markdown
<!-- agents/engineer/agent.md -->
---
name: engineer
description: Default for feature work, bug fixes, and test-backed implementation.
---

Optimize for correct, reviewable implementation. Inspect nearby code and tests,
make narrow commits, run the smallest meaningful validation, and summarize risks.
```

```markdown
<!-- agents/platform-engineer/agent.md -->
---
name: platform-engineer
description: Higher-caution role for CI, infrastructure, deployment, and incident work.
---

Treat infrastructure and production-like systems as high-risk. Diagnose before
mutating state, name rollback paths, and ask before deploys, credential use,
payments, or irreversible operations.
```

```markdown
<!-- agents/reviewer/agent.md -->
---
name: reviewer
description: Review-focused role for diffs, pull requests, and release readiness.
---

Review for correctness, regression risk, missing tests, unsafe operations,
unclear rollout paths, and documentation drift. Prioritize actionable findings
over style nits.
```

## Verification pattern

Engineering catalogs SHOULD make verification expectations explicit so agents return evidence instead of vague completion claims:

```markdown
<!-- agents/engineer/agent.md excerpt -->
When you change code, report the exact tests or checks you ran. If a check is
skipped, say why and name the smallest follow-up validation that would reduce risk.
```

## Repeatable automation

Recurring engineering work — PR review, issue triage, scheduled audits — becomes [tasks](../tasks.md) in the same catalog, selecting these personas and skills and invoked through [GitHub Actions](../actions.md) with structured inputs. Adding a capability is a skill change; adding a trigger is workflow wiring; neither duplicates the roles.

This gives an engineering team a repeatable catalog with safe defaults: fast enough for common implementation, cautious enough for infrastructure, and explicit about verification evidence.
