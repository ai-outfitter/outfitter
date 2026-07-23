# Recurring runs

Recurring agent work — "check this every N minutes", "review what landed overnight", "regenerate the weekly report" — runs three ways in the Outfitter ecosystem. All three share **one primitive**: the loop extension (Pi's `/loop <interval>`), which re-invokes an agent on a tick. What differs is who supplies the clock.

| Mechanism                                         | Clock            | Shape                                                                                                         | Use when                                                                                                                        |
| ------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Local loop extension**                          | Your own session | The agent ticks inside a session on your machine (`/loop 10m`), surveying its inputs each tick                | Watching something during your workday; developing a recurring behavior before automating it                                    |
| **[GitHub Actions](./actions.md) cron**           | The CI scheduler | `on: schedule:` workflow runs a fresh headless one-shot per tick                                              | Repo-scoped recurrences: nightly commit review, weekly KPI reports, scheduled audits                                            |
| **[In-cluster](./in-cluster.md) (Link Operator)** | Kubernetes       | A scheduled recurring CronJob, or a resident Deployment that bootstraps the same `/loop` extension in-cluster | Always-on agents with channels (email, GitHub, chat) and cluster-local access; recurrences that shouldn't depend on a repo's CI |

The graduation path mirrors [the ladder](./conventions.md): prototype the behavior with the local loop extension, move it to an Actions cron when it should run without your laptop, move it in-cluster when it needs to be resident or cluster-local. The composition — agent, skills, catalog pins — stays the same; only the trigger changes.

## Local: the loop extension

The loop extension re-invokes the agent at an interval inside a session. Each tick, a well-shaped looping agent surveys its available inputs, turns new items into tasks, and works or delegates them — rather than carrying a growing transcript of stale context. This is also exactly how the in-cluster resident agent runs: the Link Operator runtime bootstraps its long-lived session with the same `/loop` command, defaulting to a 10-minute tick.

## CI: scheduled one-shots

An Actions cron externalizes the clock to GitHub's scheduler. Each tick is a fresh, stateless headless run — compose, work once, exit — which makes it deterministic and reviewable, with a session transcript uploadable as a workflow artifact. See [`ai-outfitter/actions`](https://github.com/ai-outfitter/actions) — its `examples/scheduled-commit-review.yml` reviews the last 24 hours of commits each weekday morning and files an issue on findings.

## Cluster: CronJobs and residents

Kubernetes supplies two shapes through the [Link Operator](./in-cluster.md): a **CronJob** for scheduled recurring one-shots in the agent's namespace, and a **resident Deployment** for an always-on agent whose `/loop` tick surveys its [channels](./in-cluster.md#channels) — email, GitHub notifications, chat — for new work.

## Not a loop: event-driven runs

A webhook- or event-triggered run — one investigation Job per firing alert, one post-mortem per failed workflow — is triggered by the world, not a clock. It complements loops rather than replacing them: use a loop when work accumulates and should be swept up on a tick; use an event trigger when each unit of work announces itself. See [Grafana alert investigations](./usecases/grafana-alert-investigator.md) and [Flaky-test post-mortems](./usecases/flaky-test-postmortems.md).
