# Outfitter documentation

Outfitter lays out conventions for iterating on and sharing agent configuration — agent profiles, skills, and loadouts. The docs follow that arc: **set up** your own, **understand** the pieces, **share** them across projects and your org, **automate** them on more surfaces, then contribute back. Each page keeps to one concept and links onward when you need the next one, so nothing here has to be read up front.

Onboarding an organization? Start with
[Onboard an organization with an SDLC report](./usecases/org-onboarding-sdlc-report.md) —
one engineer runs the maturity assessment, then creates the org `.agents`
repository with the baseline report as its first commit.

## Start (you)

- [Getting started](./getting-started.md) — install, first run, default agent.
- [First-time CLI agent users](./first-time-cli-agent-users.md) — new to agent CLIs entirely.
- [Switching to Outfitter](./switching-to-outfitter.md) — adopt from an existing agent-CLI setup.
- [Porting a Claude Code setup](./porting-claude.md) — `~/.claude` into `~/.agents/` with symlinks back.

## Understand (the model)

- [Concepts](./concepts.md) — resolve → compose → adapt; layers and precedence.
- [Agents](./agents.md) — the `agents/<id>/agent.md` resource and its loadout — what you run.
- [Agent profiles](./profiles.md) — why an agent and its loadout _is_ the profile.
- [Skills](./skills.md) — capability packages with progressive disclosure, references, and routing.
- [Personas](./personas.md) — one portable Markdown file per persona; append at launch or paste anywhere.
- [Subagents and delegation](./subagents.md) — the four delegation boundaries, from in-session helpers to Kubernetes Jobs.
- [Settings](./settings.md) — scopes, schema, and the flat `settings.local.yml` override file.
- [Tasks](./tasks.md) — placeholder for a separate upcoming RFC.

## Share (project → org → community)

- [Catalogs](./catalogs.md) — publish and consume shareable `.agents` payloads; standalone and colocated layouts.
- [Conventions](./conventions.md) — place a resource once, specialize downward, never copy.
- [Local dotagents development](./local-development.md) — a personal standalone `.agents` repo that trickles upstream.
- [Iterating on an agent](./iterating-on-profiles.md) — the edit-run-inspect loop.
- [Best practices](./best-practices.md) — few agents, many skills.

## Automate (surfaces)

The same composition runs on every surface; only the trigger changes.

- [Running an agent in GitHub Actions](./actions.md) — headless runs on any workflow trigger.
- [Container images](./containers.md) — run the published Debian-based image persistently, extend it with apt, or use the `-nix` variant.
- [Recurring runs](./recurring-runs.md) — loops three ways: the local loop extension, Actions cron, cluster schedules.
- [In-cluster agents](./in-cluster.md) — resident agents, CronJobs, and subagent Jobs via Link Operator.
- [Hooks](./hooks.md) — harness hook wiring, launcher-scope system observers, and the protocol gap.
- [Dump](./dump-and-bake.md) — deterministic, self-contained `.agents/` dumps.
- [State persistence](./state.md)
- [Adapter support matrix](./support-matrix.md)

## Use cases (stories)

Each use case is a worked story — a problem, the composition that answers it, and the payoff — with links back to the concepts it uses.

- [Shared conventions without duplication](./usecases/shared-conventions.md) — one conventional-commits rule for every user, org, and project; zero copies.
- [Flaky-test post-mortems in CI](./usecases/flaky-test-postmortems.md) — an on-failure step that classifies flake vs. regression and comments with evidence.
- [Grafana alert investigations in-cluster](./usecases/grafana-alert-investigator.md) — a webhook turns each firing alert into one bounded investigation Job.
- [Self-improving skills](./usecases/self-improving-skills.md) — a weekly loop that proposes skill edits and ships only measured improvements.
- [Resident agents: a researcher wiki](./usecases/resident-agents.md) — a long-lived agent that turns an email inbox into a compounding, reviewable knowledge base.
- [Persona reviews](./usecases/persona-reviews.md) — author one persona file, run it through the shared reviewer, paste the same file into any web agent.
- [Organization catalog](./usecases/organization-profile-catalog.md) — publish shared org resources and defaults through an `owner/.outfitter` control repository.
- [Engineering catalog](./usecases/engineering.md) — package engineering agents and skills for repeatable workflows.

## Reference

- [CLI reference](./cli.md)
- [Migration from legacy profiles](./migration.md)
- [Philosophy](../philosophy.md) — why Outfitter exists.
