# Catalogs

A catalog is a git repository that publishes a `.agents` payload — agents, skills, tasks, knowledge, commands — so a person, team, or organization can share it. You can bootstrap a machine or project from one, or add one as an ongoing source that Outfitter keeps synchronized.

```bash
outfitter setup https://github.com/ncrmro/.agents
```

The repository names are discovery and distribution conventions; the payload is always the same protocol-shaped tree (pinned protocol revision [`502a9d5`](https://github.com/aj47/dotagentsprotocol-website/blob/502a9d5f886d0aad8d3da83c03354bdfa4b389e7/src/components/Structure.astro)):

| Convention                        | Purpose                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `owner/.agents` or `owner/.agent` | A shareable personal or team catalog.                                            |
| `owner/.outfitter`                | An organization/control repository distributing org-wide resources and settings. |

## Standalone `.agents` repositories (preferred)

The primary catalog pattern is a standalone repository whose **root is the payload** — the flat dotagents layout:

```text
ncrmro/.agents/            # repository root
  agents.md
  system-prompt.md
  agents/
    engineer/agent.md
    founder/agent.md
  skills/
    wiki/SKILL.md
    research/SKILL.md
  tasks/
    weekly-kpis/task.md
  knowledge/
  settings.yml             # Outfitter settings (optional; see settings.md)
  settings.local.yml       # gitignored machine-local overrides
```

This is the same layout as `~/.agents/` — a standalone catalog is simply a global layer under version control. That makes it the natural home for personal dotagents development: clone it as `~/.agents` (or point your settings at the checkout), iterate locally, and open pull requests to move improvements upstream into shared catalogs. See [Local development](./local-development.md) for the full workflow.

## Colocated `.agents/` directories (fallback)

When agent configuration should travel with a codebase, colocate the payload as a `.agents/` subdirectory beside the code:

```text
payments-service/
  .agents/
    agents/
    skills/
    settings.yml
  src/
  docs/
```

The colocated tree doubles as the protocol's workspace overlay: its resources merge by ID over the global and remote layers for anyone running in that project. Prefer the standalone pattern for anything you intend to share across projects; prefer colocation only for resources that are meaningless outside the one repository.

## Consuming a catalog

Add the repository to `sources` in your [settings](./settings.md):

```yaml
# ~/.agents/settings.yml
sources:
  - github: my-org/.agent # owner/repo shorthand
    ref: 2f9c1ab0d3e44b6f9d2c8a17e5b40c91d6f3a8e2 # pin a commit, tag, or branch
  - github: my-org/payments-service
    ref: v1.2.0
    path: .agents # colocated payload inside the repo
  - uri: git+https://git.example.com/team/agents.git # any git URI
```

Each source entry is one of:

- `path:` — a local directory (no `ref`; read live from disk).
- `github:` — an `owner/repo` GitHub shorthand.
- `uri:` — any git-cloneable URI, for non-GitHub hosts.

Remote entries additionally accept:

- `ref:` — a tag, branch, or commit to pin. With a `ref`, `outfitter sync` fetches exactly that ref. Without one, sync fast-forwards the default branch.
- `path:` — the payload directory inside the repository, for colocated layouts.

Resources from all sources resolve by slug behind local layers, following [layer precedence](./concepts.md#layer-precedence). Outfitter reports shadowed IDs so consumers can see which source supplies a selected resource.

## Organization control repositories

An `owner/.outfitter` repository distributes organization-wide resources plus shared settings that Outfitter layers below each user's local settings:

```yaml
# ~/.agents/settings.yml
remote_settings:
  - github: my-org/.outfitter
    path: .agents/settings.yml # file path inside the repo
    ref: 9c47d1e2b8a05f36c4d7e90a12b3f8c5d6e71a04
```

Remote settings are cached locally and merged at lower precedence than your project and user settings, so anything you set locally wins. This is how an organization distributes shared sources, profiles, and defaults without controlling each user's machine. See the [organization catalog use case](./usecases/organization-profile-catalog.md).

## Syncing and updating

`outfitter sync` synchronizes every remote source into the local cache:

1. Remote settings repositories are cloned or updated first, then reloaded.
2. Remote sources (including any added by remote settings) are cloned or updated.
3. Each synced source is validated; sync reports `updated`, `unchanged`, `skipped`, or `failed` per source.

Pinned (`ref:`) sources stay on their pinned ref until you change it; unpinned sources fast-forward on every sync.

## Private repositories

Private GitHub catalogs are an enterprise feature. When sync detects a private GitHub repository, it asks for confirmation before use and records the decision in your user settings. Review the Outfitter Enterprise license or your enterprise agreement before enabling private catalogs. Non-GitHub `uri:` sources use whatever git credentials your environment already has; credentials embedded in URIs are redacted from sync output.

## Trust and review

Adding a catalog source means trusting its authors with your agent runtime. A catalog's resources can shape prompts and policy (agents, `agents.md`, `system-prompt.md`), add MCP servers (`mcp.json`), and ship skills whose scripts execute on your machine.

Before adding a source, review it:

1. Read the agent definitions, `agents.md`, and `system-prompt.md` you will compose.
2. Read every skill you will select, including its scripts and catalog-owned `file` references (see the [trust boundary](./skills.md#trust-boundary)).
3. Review `mcp.json` — MCP servers are code with whatever access you grant them.
4. Check `remote_settings` targets: a settings file can add further sources you did not review.
5. Confirm the repository's ownership and that its maintainers are who you expect.

**Pin a `ref:`** — ideally a full commit SHA — for any catalog you do not maintain yourself, and always for catalogs consumed in CI (see [Running tasks in GitHub Actions](./actions.md)). A pinned ref makes updates an explicit, reviewable action — bump the ref after reviewing the diff — instead of silently pulling whatever the catalog publishes next.
