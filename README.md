# Outfitter

Outfitter is the toolchain for the [Dotagents `.agents` protocol](./docs/documentation/concepts.md): it resolves agent configuration from local and remote `.agents` trees, composes agents, skills, and knowledge by slug, and launches the result through wrapped agent CLIs like [`pi`](https://github.com/earendil-works/pi-coding-agent) and Claude Code.

Outfitter does not own a configuration format. Your `.agents/` directory is the source of truth — useful without Outfitter, committed and reviewed like any other code.

> These docs are the authoritative description of the `.agents` model Outfitter implements — start with [Concepts](./docs/documentation/concepts.md). For interchange, Outfitter pins draft protocol revision `502a9d5` of the referenced [external protocol site](https://dotagentsprotocol.com/). Implementation is rolling out across releases — a published CLI may lag these docs; [Migration](./docs/documentation/migration.md) covers the legacy profile format. For the design history, see [RFC #165](https://github.com/ai-outfitter/outfitter/issues/165).

## Why

Your agent setup is configuration: prompts, skills, MCP servers, model choices, permissions. Left alone it lives per tool and per laptop, gets pasted between repos, and drifts. Outfitter treats it like the rest of your infrastructure — layered, composed by slug, pinned by SHA, reviewed through pull requests.

That turns one person's improvement into everyone's default. On Monday a platform engineer writes a `grafana-alert-investigate` skill in their own `~/.agents` tree and uses it at their desk. By Friday it is merged into the org catalog, pinned by version, and selected by slug from an agent that also runs on a CI schedule and in the cluster. Nobody else configured anything — their next run composes the new skill, and it costs their context window one line of routing metadata until it activates.

Two ideas carry most of that leverage:

- **The ladder.** Resources start personal and graduate upward — and every layer below inherits them back:

  ```mermaid
  flowchart LR
    A["~/.agents<br/>(you)"] --> B["project/.agents<br/>(your repo)"]
    B --> C["org catalog<br/>(pinned by SHA)"]
    C --> D["community catalogs"]
    D -. "inherited + overridable by ID" .-> A
  ```

  ID-addressed resources — agents, skills, knowledge — override by ID across layers, and root shared context is selected by layer precedence, so you author a rule or skill once at the most general layer where it holds and specialize downward — never copy. See [Conventions](./docs/documentation/conventions.md).

- **The surfaces.** The same composition runs everywhere work happens: interactively at your desk, [in GitHub Actions](./docs/documentation/actions.md) on any trigger, as [recurring loops](./docs/documentation/recurring-runs.md) — locally, on a CI cron, or on a cluster schedule — and as resident or job-based agents [in Kubernetes](./docs/documentation/in-cluster.md). Surface availability varies by release; each page notes its status.

For the full argument, read the [Philosophy](./docs/philosophy.md).

## Quick start

Run without installing:

```bash
npx @ai-outfitter/outfitter
```

Full install:

```bash
npm install -g @ai-outfitter/outfitter
outfitter
```

Pi is bundled and also hosts Outfitter's setup walkthrough. Install other runtime harnesses, such as
Claude Code, separately. For the full walkthrough, see [Getting started](./docs/documentation/getting-started.md).

## Already have a `.agents/` directory?

Then you already have Outfitter configuration. Each agent's loadout references your existing skills, subagents, MCP, knowledge, and commands by slug with zero porting:

```
<!-- .agents/agents/engineer/agent.md -->
---
name: engineer
skills: [wiki, research]
subagents: [code-reviewer]
mcp: [github]
---
```

```yaml
# .agents/settings.yml
default_agent: engineer
```

`outfitter setup` restores the original Pi-native profile-catalog walkthrough on top of `.agents`:
choose the default Outfitter catalog, create your own profile, or provide another catalog, then pick
the home/project target and default CLI agent. The default picker is fetched from the immutable
`ai-outfitter/default-profiles` Release Please tag pinned by Outfitter—never from a sibling checkout.
Managed porting and persistent harness symlinks are deferred to
[#187](https://github.com/ai-outfitter/outfitter/issues/187).

## The `.agents` protocol in 30 seconds

```text
.agents/
  agents.md            # shared operating context
  system-prompt.md     # base system prompt
  mcp.json             # MCP servers
  models.json          # model configuration
  agents/<id>/agent.md # identities + loadouts — run directly or as subagents
  skills/<id>/...      # capability packages
  knowledge/           # reference documents
  commands/            # slash commands
```

Layers merge by ID: `<project>/.agents/` over `~/.agents/` over pinned remote [catalogs](./docs/documentation/catalogs.md). An [agent](./docs/documentation/agents.md) carries both its identity and its loadout — an [agent profile](./docs/documentation/profiles.md) — and is what you run; a [persona](./docs/documentation/personas.md) is a review convention layered on a base agent; a [subagent](./docs/documentation/subagents.md) is an agent a run delegates to, across [four delegation boundaries](./docs/documentation/subagents.md#the-four-delegation-boundaries) from an in-session helper to a Kubernetes Job.

## Documentation

The [documentation index](./docs/documentation/README.md) is organized as a journey — start personal, understand the model, grow across your org, automate more surfaces, contribute back:

- **Start:** [Getting started](./docs/documentation/getting-started.md) · [First-time CLI agent users](./docs/documentation/first-time-cli-agent-users.md) · [Switching to Outfitter](./docs/documentation/switching-to-outfitter.md)
- **Understand:** [Concepts](./docs/documentation/concepts.md) · [Agents](./docs/documentation/agents.md) · [Skills](./docs/documentation/skills.md) · [Personas](./docs/documentation/personas.md) · [Subagents and delegation](./docs/documentation/subagents.md)
- **Grow:** [Catalogs](./docs/documentation/catalogs.md) · [Conventions](./docs/documentation/conventions.md) · [Organization catalog](./docs/documentation/usecases/organization-profile-catalog.md) · [Best practices](./docs/documentation/best-practices.md)
- **Automate:** [GitHub Actions](./docs/documentation/actions.md) · [Recurring runs](./docs/documentation/recurring-runs.md) · [In-cluster agents](./docs/documentation/in-cluster.md) · [Hooks](./docs/documentation/hooks.md) · [State persistence](./docs/documentation/state.md)
- **Reference:** [CLI](./docs/documentation/cli.md) · [Settings](./docs/documentation/settings.md) · [Adapter support matrix](./docs/documentation/support-matrix.md) · [Philosophy](./docs/philosophy.md)

Use cases, story first:

- [Shared conventions without duplication](./docs/documentation/usecases/shared-conventions.md) — one conventional-commits rule for every user, org, and project; zero copies.
- [Flaky-test post-mortems in CI](./docs/documentation/usecases/flaky-test-postmortems.md) — an on-failure step that classifies flake vs. regression and comments with evidence.
- [Grafana alert investigations in-cluster](./docs/documentation/usecases/grafana-alert-investigator.md) — a webhook turns each firing alert into one bounded investigation Job.
- [Self-improving skills](./docs/documentation/usecases/self-improving-skills.md) — a weekly loop that proposes skill edits and ships only measured improvements.
- [Persona reviews](./docs/documentation/usecases/persona-reviews.md) — customer personas your whole team can ask for feedback.
- [Organization catalog](./docs/documentation/usecases/organization-profile-catalog.md) — shared org resources and defaults through a control repository.
- [Engineering catalog](./docs/documentation/usecases/engineering.md) — engineering agents and skills for repeatable workflows.

For local development, repository structure, and release workflow details, see [Contributing](./CONTRIBUTING.md).

## License

Outfitter is [MIT licensed](./LICENSE.md), except for code in `code/enterprise/`, which is under the [Unsupervised Enterprise license](./code/enterprise/LICENSE). Production use of that code requires a valid Unsupervised Enterprise license.
