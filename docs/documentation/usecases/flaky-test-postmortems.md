# Flaky-test post-mortems in CI

Slow system tests tax a team twice: once waiting for the run, and again when a red X lands and someone has to decide whether it is a real regression or last week's timing flake. Most of that second tax is mechanical — fetch the logs, compare against the diff, remember whether this failure signature has appeared before — which makes it delegable.

## The composition

One optional on-failure step hands the event to the shared CI agent the repository already runs through [`ai-outfitter/actions`](https://github.com/ai-outfitter/actions) — no new workflow, no new agent:

- **Trigger.** The test workflow's failure (`if: failure()`) invokes the shared agent with structured `trigger_context` — workflow name, run id, a `failure_kind` — as opaque routing metadata, never as instructions ([Running an agent in GitHub Actions](../actions.md)).
- **Routing.** The agent maps `failure_kind: system-tests` to exactly one skill, a `test-postmortem` capability; the skill then fetches logs and the diff with trusted tools. This is the _few agents, many skills_ shape from [Best practices](../best-practices.md) — adding release-note triage later adds a skill and an activation rule, not another agent.
- **Verdict.** The skill classifies flake vs. real regression with a confidence level and posts one comment on the PR with its evidence. Comment-only is the safe default mode.
- **Audit.** The run uploads its session transcript as a workflow artifact, so anyone can read exactly how the agent reached its verdict.

## Escalation, governed

Auto-fixing is opt-in and label-gated: with the label present, the agent may push a single fix commit under a machine-account token (the default `GITHUB_TOKEN` deliberately cannot re-trigger CI). Stacked guards keep the loop bounded — a recursion guard, an attempt cap that hands off to a human, workflow `concurrency` with `cancel-in-progress` and `timeout-minutes`, and the label itself limiting blast radius. The machine-account and token-scoping decisions are documented in the [`ai-outfitter/actions`](https://github.com/ai-outfitter/actions) credential guides.

## Payoff

The red X arrives already triaged: a verdict, a confidence, the evidence, and a transcript — and the team decides only what to do about it. The delegation crosses the [CI-backed boundary](../subagents.md#the-four-delegation-boundaries); the same event-driven shape powers [alert investigations in-cluster](./grafana-alert-investigator.md).
