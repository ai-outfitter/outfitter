---
name: outfitter
description: Outfitter's always-on advisor. Explain Outfitter and compose/inspect/maintain .agents resources, agents and their loadouts, personas, skills, and settings — and, proactively, recognize which agentic-design patterns fit the user's project and apply them with Outfitter's primitives, so the user need not be an expert in agentic design. Use when a user asks about Outfitter itself (the .agents protocol, profiles, personas, catalogs, skills, settings, launches) or asks to set up/change/debug/migrate a launch; also engage proactively while composing agents, CI, or deployments, and when asked to audit a project for agentic-pattern opportunities.

# TODO: once directory reference materialization lands, collapse the list
# below to a single `- file: docs/documentation` entry so the whole
# documentation tree ships with this skill. Kept per-file until then.
references:
  - file: docs/documentation/README.md
  - file: docs/documentation/getting-started.md
  - file: docs/documentation/concepts.md
  - file: docs/documentation/settings.md
  - file: docs/documentation/cli.md
  - file: docs/documentation/profiles.md
  - file: docs/documentation/personas.md
  - file: docs/documentation/subagents.md
  - file: docs/documentation/agents.md
  - file: docs/documentation/skills.md
  - file: docs/documentation/tasks.md
  - file: docs/documentation/dump-and-bake.md
  - file: docs/documentation/catalogs.md
  - file: docs/documentation/state.md
  - file: docs/documentation/support-matrix.md
  - file: docs/documentation/best-practices.md
  - file: docs/documentation/actions.md
  - file: docs/documentation/hooks.md
  - file: docs/documentation/switching-to-outfitter.md
  - file: docs/documentation/porting-claude.md
  - file: docs/documentation/local-development.md
  - file: docs/documentation/migration.md
  - file: docs/documentation/first-time-cli-agent-users.md
  - file: docs/documentation/iterating-on-profiles.md
  - file: docs/documentation/conventions.md
  - file: docs/documentation/recurring-runs.md
  - file: docs/documentation/in-cluster.md
  - file: docs/documentation/channels.md
  - file: docs/documentation/usecases/organization-profile-catalog.md
---

# Outfitter

Use this skill to answer questions about Outfitter, to make changes to `.agents`
resources and launches, and — proactively — to recognize when an agentic-design
**pattern** fits the user's project and offer to apply it. The user should not have
to be an expert in agentic design: that expertise lives in these references, and
your job is to bring the right pattern to their situation. Classify the request,
read only the relevant reference, and follow its cross-references before answering
or editing configuration.

Be proactive but not noisy: when a project signal in **Agentic patterns** appears
while you work — or when the user asks for help without a specific request, or asks
you to **audit** their project — surface the fitting pattern and offer to apply it.
Suggest the one or two highest-value patterns, not every possibility.

## Routing

- New to Outfitter, installing, or first launch: read
  `references/getting-started.md`.
- How a launch works — the `.agents` protocol, layers, resolver, composition:
  read `references/concepts.md`.
- Settings scopes, schema, or `settings.local.yml`: read
  `references/settings.md`.
- Command flags and syntax for `outfitter run`, `setup`, `sync`, `list`,
  `validate`, or `dump`: read `references/cli.md`.
- Agent profiles — an agent and its loadout (skills, subagents, mcp,
  extensions, plugins, model, thinking, tools): read `references/profiles.md`.
- The `agents/<id>/agent.md` resource format and loadout fields: read
  `references/agents.md`.
- Personas — the base-agent-plus-persona-documents convention: read
  `references/personas.md`.
- Subagents and leader-agent delegation: read `references/subagents.md`.
- Authoring or selecting skills, SKILL.md layout, skill references: read
  `references/skills.md`.
- Tasks and bake (a separate upcoming RFC): read `references/tasks.md`.
- Dumping the composed tree: read `references/dump-and-bake.md`.
- Shared catalogs, standalone `.agents` repositories, remote sources,
  publishing resources: read `references/catalogs.md`.
- What persists between runs, state persistence strategies, prompt choices:
  read `references/state.md`.
- What Outfitter can project per agent CLI (pi, Claude Code): read
  `references/support-matrix.md`.
- Structuring agent identity versus skills, keeping instructions in one place:
  read `references/best-practices.md`.
- Running tasks headlessly in GitHub Actions: read `references/actions.md`.
- Recurring or scheduled work, and the local-loop → Actions-cron → cluster
  graduation ladder: read `references/recurring-runs.md`.
- Running agents in Kubernetes — resident, CronJob, or subagent Jobs via the
  operator: read `references/in-cluster.md`.
- Channel intake (email, Signal, GitHub notifications) that wakes an agent on new
  work: read `references/channels.md`.
- Ambient, always-true rules and "place once, specialize downward": read
  `references/conventions.md`.
- An organization adopting Outfitter — a control catalog and shared defaults: read
  `references/usecases/organization-profile-catalog.md`.
- Getting hooks working per harness: read `references/hooks.md`.
- Migrating from another agent CLI setup: read
  `references/switching-to-outfitter.md`.
- Porting an existing `~/.claude` directory into `~/.agents`: read
  `references/porting-claude.md`.
- Developing a personal `.agents` repository and upstreaming changes: read
  `references/local-development.md`.
- **Migrating from legacy `.outfitter` profiles** (`profile.yml`,
  `.outfitter/profiles`, `--profile` file ids): read `references/migration.md`.
  The runtime has no legacy compatibility; this reference is the manual
  migration path.
- Never used a CLI coding agent before: read
  `references/first-time-cli-agent-users.md`.
- Improving the currently active agent, including this launch's own
  configuration: read `references/iterating-on-profiles.md`.

`references/README.md` is the documentation index if no entry above fits.

## Agentic patterns

Watch for these project signals. When one appears, name the fitting pattern, read
its reference, then propose the concrete change and offer to apply it (see
*Applying changes*). Bring the pattern to the user — don't require them to know it.

- **Repo receives issues or PRs** → a headless CI agent that triages, labels, and
  comments (`actions-agent` + an `issue-triage`-style skill). Reference:
  `references/actions.md`. Apply: scaffold the workflow and the agent.
- **"Every N", "nightly", "watch", a recurring chore** → the graduation ladder:
  local loop → Actions cron → in-cluster CronJob/resident. Reference:
  `references/recurring-runs.md`. Apply: pick the surface matching how often and
  where it must run; the composition stays the same, only the trigger changes.
- **Inbound messages — email, Signal, GitHub notifications** → channel intake: the
  `channels` extension wakes the agent, paired with a channel skill. Reference:
  `references/channels.md`.
- **Always-on or cluster-local access** → an in-cluster resident agent with Secrets
  and quota. Reference: `references/in-cluster.md`. Apply: compose an
  `Organization` + `Agent`.
- **One agent per task, or a profile carrying every capability** → few agents, many
  skills; make broad skills routers. References: `references/best-practices.md`,
  `references/skills.md`. Apply: split capabilities into skills selected by loadout.
- **Cross-context, parallelizable, or review work** → subagent delegation (a leader
  with bounded delegates). Reference: `references/subagents.md`.
- **A rule that should always hold — commit style, secret hygiene** → author it once
  in the tree's shared `agents.md` and inherit down; never paste it per-agent or
  make it a skill. Reference: `references/conventions.md`.
- **An organization adopting Outfitter** → an `owner/.outfitter` control catalog
  with shared conventions and pinned revisions. References:
  `references/usecases/organization-profile-catalog.md`, `references/catalogs.md`.

## Audit a project

When the user asks you to audit their project — or asks for help without a specific
request — do a quick pass and surface the highest-value opportunities:

1. **Survey signals:** repo type and languages; existing `.agents` (agents, skills,
   settings); CI workflows (`.github/workflows`); Kubernetes manifests; credentials
   or channel configuration; and the user's stated goal.
2. **Match** them against *Agentic patterns* above.
3. **Present a prioritized shortlist** — the two or three highest-value patterns,
   not every match — each as: the opportunity, the pattern, and the concrete change
   you would make.
4. **Offer to apply** the top one, and apply it per *Applying changes* on
   confirmation.

## Working on Outfitter configuration

1. Inspect the current configuration before editing:
   - `.agents/settings.yml` and `.agents/settings.local.yml`
   - `.agents/agents/` and `.agents/skills/`
   - `~/.agents/settings.yml` and the `~/.agents/` tree
2. Prefer Outfitter commands over manual inspection:
   - `outfitter list` to inspect resolvable resources and their sources
   - `outfitter validate` to check layout, loadouts, and references
   - `outfitter setup <source>` to import catalogs
   - `outfitter sync` to refresh remote sources
   - `outfitter run <agent-id>` to verify launch behavior
   - `outfitter dump --out <dir>` to inspect exactly what a run composes
3. Keep each instruction in one place: durable identity belongs in the agent
   definition, per-capability procedure belongs in a skill
   (`references/best-practices.md`).
4. Apply patterns end to end — don't stop at describing them:
   - **Compose:** write/edit the `.agents` resources directly (agents, skills,
     loadouts, shared `agents.md`) — what `outfitter` governs.
   - **CI:** scaffold the workflow and open it with `gh` (`references/actions.md`).
   - **In-cluster:** apply the `Organization`/`Agent` custom resources with
     `kubectl` (`references/in-cluster.md`).
   - **Catalog:** pin a revision or open a catalog PR (`references/catalogs.md`).
5. Validate before applying: `outfitter validate --strict`, and when possible a
   dry `outfitter dump --out <dir>` or `outfitter run <agent-id> -- --help` smoke
   test.
6. **Confirm before any outward or irreversible action** — opening a PR, pushing,
   applying cluster resources, or anything that leaves the local workspace. State
   exactly what you will run, then act only on approval.

## Default behavior

If the user asks for help with Outfitter without a specific request:

1. Run `outfitter list agents` to show resolvable agents and resources.
2. Summarize the agents by name, scope or source, and default status.
3. Offer to **audit the project** for agentic-pattern opportunities (see *Audit a
   project*), or to compose or change an agent — reading `references/profiles.md`
   and `references/agents.md` before editing.
