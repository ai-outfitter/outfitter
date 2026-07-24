# Grafana alert investigations in-cluster

Resource alerts are noisy: CPU pinned where it is always pinned, a pod that quietly died and restarted, an OOMKill that actually matters. A human triages every one, or the channel gets muted. The triage itself — scope to the resource, read the dashboards and logs for the alert window, decide expected vs. anomaly — is bounded work an agent can do per alert.

## The composition

- **Trigger.** A `kube-prometheus-stack` Alertmanager webhook receiver (added with `continue: true`, so human paging is untouched) turns each firing alert into one bounded headless run; alert labels travel as untrusted channel data used only for routing, never as instructions ([trust boundary](../skills.md#trust-boundary)).
- **Agent.** The community-catalog `grafana-agent` profile ([community-profiles#10](https://github.com/ai-outfitter/community-profiles/pull/10)) routes alert work to two agent-local skills — investigate and issue-triage — plus a per-agent MCP declaration for the already-running [`grafana/mcp-grafana`](https://github.com/grafana/mcp-grafana) server, giving it Loki, Prometheus, Tempo, and Pyroscope, alongside a read-only Kubernetes view. The same profile owns the setup half (provisioning that MCP securely) behind a separate, explicitly-requested-only skill.
- **Verdict.** The investigation is scoped to the alerting resource and the alert window, and classifies the alert `expected` (known-noisy — recommend tuning or ignoring the rule) or `anomaly` (OOMKill, non-zero exit, a new hot path) with a confidence level.
- **Safe default.** The agent posts exactly one diagnosis comment on the existing tracking issue. It never mutates a workload and never edits the issue — comment-only is the only mode.

## The wiring

The agent itself is deliberately deployment-agnostic; the Link Operator's webhook-driven design supplies the in-cluster wiring ([In-cluster agents](../in-cluster.md) — a design preview until the operator ships): a webhook receiver channel materializes **one subagent Job per firing alert** in the agent's namespace, sharing its service account and quota — bounded, timeout-enforced, read-only RBAC. This is the push style of channel intake; the same agent could instead be swept up by a resident agent's [loop tick](../recurring-runs.md).

## Payoff

Every alert arrives with a diagnosis already attached: what fired, what the dashboards and logs show for the window, expected or anomaly, and with what confidence — and the on-call human spends attention only on the anomalies. Setting up the observability stack this rides on (provisioning Grafana alerting, the MCP server, read-only RBAC) is platform-profile work — the [role-profile convention](../conventions.md#worked-example-a-role-profile) ([#197](https://github.com/ai-outfitter/outfitter/issues/197)).
