# In-cluster agents

The [Link Operator](https://github.com/ai-outfitter/link-operator) runs Outfitter-composed agents inside a Kubernetes cluster. The operator provides **primitives only** — namespace, quota, secrets exposure, pinned catalog resolution, and starting the runtime — while everything behavioral (which agent, which skills, which channels) stays ordinary `.agents` composition, reviewed and pinned like anywhere else.

## The primitives

- **`Organization`** — ownership plus one commit-pinned catalog source. The operator writes the pin into the runtime's `.agents/settings.yml`; agents resolve their composition from it exactly as a local run would.
- **`Agent`** — a namespace of its own (`agent-<name>`), a service account bound only within that namespace, operator-owned quota and limits, a durable volume, and a long-running Deployment for the resident runtime.

The operator never interprets a profile, reads a secret's contents, or invokes the model — it provisions and starts; the agent layer does the rest.

## Execution shapes

| Shape                  | Kubernetes resource | Trigger                                                                                         |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------------- |
| Resident agent         | Deployment          | The [loop extension](./recurring-runs.md) tick (default 10m): survey channels, work or delegate |
| Scheduled recurrence   | CronJob             | The cluster's clock — recurring one-shots in the agent's namespace                              |
| Delegated / event work | Job (subagent)      | Spawned by the resident agent, or one Job per incoming event (e.g. a firing alert via webhook)  |

Subagent Jobs share the owning agent's service account and quota, so delegation never escalates privilege — the fourth of the [four delegation boundaries](./subagents.md#the-four-delegation-boundaries).

## Channels

A **channel** is an adapter to an external event or message source — email, GitHub notifications, Signal — that supplies the agent's work intake. Channels are agent-runtime concerns, composed as skills, MCP servers, or extensions in the catalog; they are never operator primitives. Two intake styles:

- **Poll** — the resident loop's tick surveys the channel (an inbox, a notifications feed) for new items.
- **Push** — a webhook receiver materializes one bounded subagent Job per event.

Treat channel content — email bodies, issue text, alert annotations — as untrusted data, never instructions, the same trust rule as [skill references](./skills.md#trust-boundary).

## Worked story

[Grafana alert investigations in-cluster](./usecases/grafana-alert-investigator.md): an Alertmanager webhook turns each firing alert into one investigation Job that reads dashboards and logs through the Grafana MCP plus a read-only Kubernetes view, classifies expected vs. anomaly, and posts exactly one diagnosis comment — never mutating a workload.
