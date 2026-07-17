# Organization Catalog

An organization catalog publishes named role agents instead of asking every user to choose models, prompts, skills, and MCP configuration by hand. The convention is an `owner/.outfitter` control repository carrying a protocol `.agents/` payload: `acme/.outfitter` can give engineers, platform operators, support staff, and executives a useful default session while still letting projects override the final composition.

```text
acme/.outfitter/
  .agents/
    agents.md              # shared Acme operating rules for every role
    models.json
    agents/
      engineer/agent.md
      platform-operator/agent.md
      support-triage/agent.md
      exec-briefing/agent.md
    settings.yml
```

## Catalog settings

The catalog's `settings.yml` names the default agent; the organization distributes it through [remote settings](./../catalogs.md#organization-control-repositories):

```yaml
# acme/.outfitter/.agents/settings.yml
default_agent: engineer
```

## Shared operating context

Rules every role shares live in the tree's `agents.md`, inherited by each agent without ordered persona composition:

```markdown
<!-- .agents/agents.md -->

Work as an Acme operator: prefer small reversible changes, cite durable
evidence, keep secrets out of logs and docs, and write decisions into
repository files.
```

## Role agents

The catalog SHOULD publish role agents that make the cost/latency/quality tradeoff explicit. Model choices live in each agent's `config.json` (or the tree's `models.json`); replace the IDs below with the exact names exposed by the organization's provider catalog.

```
<!-- .agents/agents/engineer/agent.md -->
---
name: engineer
description: Default for feature work, debugging, tests, and code review.
---

Optimize for correct implementation over speed. Read nearby code before
editing, run the narrowest meaningful tests, and return changed files plus
verification.
```

```json
// .agents/agents/engineer/config.json
{ "provider": "anthropic", "model": "anthropic/claude-sonnet-4", "thinking": "high" }
```

```
<!-- .agents/agents/platform-operator/agent.md -->
---
name: platform-operator
description: Higher-reasoning role for infrastructure, incidents, CI, and release safety.
---

Treat production-like systems as high-risk. Prefer diagnosis before mutation,
name rollback paths, and ask before deploys, credential use, payments, or
irreversible changes.
```

```
<!-- .agents/agents/support-triage/agent.md -->
---
name: support-triage
description: Lower-cost role for ticket summarization, reproduction notes, and routing.
---

Convert messy user reports into concise reproduction steps, affected surfaces,
suspected owners, and the next question that would unblock diagnosis.
```

```
<!-- .agents/agents/exec-briefing/agent.md -->
---
name: exec-briefing
description: Fast role for dense status synthesis and decision memos.
---

Produce dense prose for leaders: state the decision, evidence, risk, owner,
deadline, and the smallest reversible next action. Avoid implementation trivia
unless it changes the decision.
```

## Budget annotation pattern

Agent `config.json` entries can carry comments-in-docs that explain why a role uses a given model and thinking level without embedding current vendor prices. Keep the metric relative, because token prices and model names drift:

```text
budget_units estimates relative spend and latency for a role, not an invoice.
budget_units = expected_input_tokens * input_weight
             + expected_output_tokens * output_weight
             + expected_reasoning_tokens * thinking_weight
thinking_weight guideline: low=1, medium=2, high=4, xhigh=8.
Use low/medium for repeatable summarization or routing; use high/xhigh when a
wrong answer can cause rework, outages, bad code, unsafe operations, or
expensive human review.
```

## Governance

Because the catalog is a normal repository publishing normal files, organization changes flow through ordinary pull requests: a role prompt change is a reviewable diff to one `agent.md`. Consumers pin the catalog by SHA and bump deliberately; `outfitter dump` shows exactly what a pinned composition resolves to before an approval. Recurring org automation — like a `weekly-kpis` report — lives in the same repository as an agent run through [GitHub Actions](../actions.md); a dedicated task/bake contract for that work is a [separate upcoming RFC](../tasks.md).
