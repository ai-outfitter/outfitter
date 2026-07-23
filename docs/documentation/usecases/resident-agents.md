# Resident agents: a researcher wiki

Knowledge work accumulates faster than anyone organizes it: the paper a colleague forwarded, the article dying in a browser tab, the half-formed connection between them that lives nowhere at all. The standard machine answer — embed everything and retrieve over it — re-derives understanding from scratch on every question and throws the derivation away with the answer; ask twice and the system does the same work twice, no smarter the second time.

The alternative is an agent that organizes material _as it arrives_: a long-lived resident that maintains a persistent, compounding markdown wiki. The pattern is Andrej Karpathy's ["LLM Wiki" gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — an LLM curating an interlinked knowledge base as its durable memory — worked here as an Outfitter composition.

## The composition

- **Resident, not invoked.** The maintainer is a long-lived in-cluster agent — a resident Deployment in the design previewed in [In-cluster agents](../in-cluster.md) — whose [loop tick](../recurring-runs.md) surveys its channels for new work. An email inbox is the intake: email a paper, an article, or a stray thought to the agent's address, and the next tick picks it up.
- **Ingest per message.** Each new source becomes one bounded ingest:
  - a summary page written in the wiki's own voice and link style;
  - the entity and concept pages the source touches cross-referenced and updated;
  - contradictions with older claims flagged on the page, never silently overwritten;
  - the index and an append-only ingest log updated, so the wiki's growth is itself readable history;
  - a reply sent in-thread pointing at the wiki commit that resulted.

  Email bodies and attachments are **untrusted data, never instructions** — the same trust rule every [channel](../in-cluster.md#channels) carries.

- **The wiki is the durable state.** The wiki is a git repository of markdown. The agent's runs stay stateless and restart-safe because the system of record lives outside the process — and every change the agent makes is a commit a human can review, diff, or revert. There is no opaque memory to trust; the agent's understanding _is_ the repository.
- **Query and lint ride the same composition.** Ask a question by mail or issue and the answer cites wiki pages, with any durable synthesis filed back as pages of its own — so explorations compound instead of evaporating. A scheduled lint pass — a cluster CronJob, or an Actions cron if the wiki repo's CI should own it ([Recurring runs](../recurring-runs.md)) — opens a PR listing contradictions, orphaned pages, stale claims, and suggested sources worth ingesting next.

## The wiring

The agent itself is deployment-agnostic; the resident shape comes from the in-cluster design ([In-cluster agents](../in-cluster.md) — a design preview until the operator ships). An `Agent` resource gives the maintainer its own namespace, service account, and durable volume; the resident Deployment bootstraps the same `/loop` extension you would run locally, on a default 10-minute tick; and a heavyweight ingest can be delegated to a subagent Job that shares the agent's service account and quota. The inbox is the poll style of channel intake — the complement of the push style that powers [alert investigations](./grafana-alert-investigator.md).

## Payoff

The wiki compounds instead of being re-derived. A question asked in month six is answered against six months of accumulated, cross-linked, human-reviewable understanding — not a fresh retrieval pass over raw sources — and the maintenance the knowledge base needs arrives as reviewable PRs rather than silent drift. The lint report doubles as a free scoring signal: its findings can gate skill edits exactly the way the CAD benchmark does in [Self-improving skills](./self-improving-skills.md).

## Graduation

The profile packaging this — a `wiki-maintainer` agent with agent-local ingest, query, and lint skills, in review in [`ai-outfitter/community-profiles`](https://github.com/ai-outfitter/community-profiles) — climbs the usual ladder:

1. **Personal** — the same agent at your desk with the local loop extension, pointed at a personal wiki repo.
2. **Org** — intake moves to an Actions cron over a shared knowledge-base repo when it should run without your laptop.
3. **Communal** — resident in-cluster, where every contributor's agent runs the same pinned profile against the same wiki.

The composition never changes across the ladder — only the clock and the surface do.
