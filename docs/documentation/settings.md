# Settings

Outfitter settings configure how resources are resolved and launched. They live inside the `.agents` tree so a tree carries everything it needs, and they are the only Outfitter-specific files in it — deleting them leaves a pure protocol payload.

Settings do not carry an agent's resource selections. An agent's loadout — its skills, subagents, model, and so on — lives on the [agent](./agents.md). Settings separately record which workflow roots are explicitly enabled.

## Scopes

| Scope         | File                                                       | Purpose                                                        |
| ------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| Project-local | `<project>/.agents/settings.local.yml`                     | Personal, uncommitted overrides for one machine. Gitignore it. |
| Project       | `<project>/.agents/settings.yml`                           | Committed settings shared by everyone on the project.          |
| User          | `~/.agents/settings.yml` (+ optional `settings.local.yml`) | Personal defaults across projects.                             |
| Remote        | Cached files from `remote_settings`                        | Organization-distributed defaults.                             |

`settings.local.yml` is a flat file beside `settings.yml` — there is no nested local directory. It overlays its sibling with the same schema and higher precedence, and is the natural home for machine-specific values such as absolute paths to local checkouts (see [Local development](./local-development.md)).

In a standalone `.agents` repository the repository root is the tree, so the files are simply `settings.yml` and `settings.local.yml` at the root.

## Schema

```yaml
# .agents/settings.yml
default_agent: engineer # which agent runs by default
default_harness: pi # which harness to launch: pi, claude, or codex
isolation: inherit # inherit (default) or isolated; see below. Honored only from ~/.agents.

# Where protocol resources come from, beyond this tree and ~/.agents.
sources:
  - github: ai-outfitter/.agent # owner/repo shorthand
    ref: 2f9c1ab0d3e44b6f9d2c8a17e5b40c91d6f3a8e2 # pin a commit, tag, or branch
    # path: optional subdirectory containing the payload
  - uri: git+https://git.example.com/team/agents.git
    ref: v1.2.0
  - path: ../shared-agents # local directory, read live from disk

# Workflow roots this project explicitly enables from the effective resource set.
workflows:
  - software-factory
  - adversarial-review

# Organization-distributed settings, layered below local settings.
remote_settings:
  - github: my-org/.outfitter
    path: .agents/settings.yml
    ref: 9c47d1e2b8a05f36c4d7e90a12b3f8c5d6e71a04

cache_directory: ./cache # optional; relative to this settings file
source_cache:
  policy: repair # repair (default), locked, or offline

# Pseudonymous product analytics consent; defaults to true when absent.
telemetry:
  enabled: false

# Additive loadout entries composed into every agent ahead of its own loadout.
agent_defaults:
  extensions:
    - git:github.com/ai-outfitter/pensieve@4b1e0d2c9a7f35e86b0d1c4a92f6e3d5a8b7c601
  skills:
    - organization-practices
  mcp:
    - github
  append_system_prompt:
    - file: prompts/organization.md

# Native harness settings shared by every agent run.
harness_defaults:
  pi:
    httpIdleTimeoutMs: 3600000
```

- `default_agent` / `default_harness` — which agent plain `outfitter` runs, and the harness it launches in.
- `isolation` — whether a run stands on the harness configuration already on this machine. `inherit`, the default, layers the composition over it, so a Claude run keeps your workspace trust, permissions, credentials, plugins, and MCP servers. `isolated` launches from the composition alone, which is what a reproducible CI or container run wants; `--isolated` selects it for one run. Only Claude has an inherit path today. This key is honored **only** from your own `~/.agents` settings: a checked-in project or a remote catalog must not decide how much of your machine a profile it ships can see.
- `sources` — ordered list of remote or local `.agents` payloads. Remote entries (`github:` / `uri:`) accept `ref:` pinning and an optional `path:` to the payload inside the repository; see [Catalogs](./catalogs.md) for conventions and trust guidance.
- `workflows` — unique workflow root slugs enabled by this file. The effective set is the ordered, deduplicated union from every loaded remote, user, user-local, project, and project-local settings file. Missing and empty lists enable no roots. Source catalogs contribute definitions, but their settings are not loaded. `outfitter list workflows` shows enabled roots only; `outfitter validate` fails when an enabled root is not resolvable or its reachable workflow, agent, and resource closure is invalid; and `outfitter dump --workflow <slug>` requires the root itself to be enabled. Nested workflow dependencies are enabled implicitly for an enabled root's closure, but cannot be dumped directly unless separately listed. Normal resource precedence applies, so a project workflow definition overrides the same slug from the user or a catalog.
- `remote_settings` — shared settings a repository distributes; cached locally and merged below your project and user settings, so anything you set locally wins.
- `cache_directory` — the repository cache root used consistently by sync, remote settings, remote
  source resolution, and default-catalog setup. It defaults to `~/.agents/cache`; repositories live
- `source_cache.policy` — verifies remote caches before `run`: `repair` reuses healthy caches and
  atomically repairs unhealthy ones, `locked` also requires full commit pins, and `offline` never
  accesses the network.
  below its `repos/` directory.
- `telemetry.enabled` — the primary and sole persistent control for pseudonymous product analytics. Edit it directly to enable or disable telemetry. See [Telemetry](./telemetry.md) for consent precedence, automatic identifier cleanup, the event contract, and the current inert-build status.
- `agent_defaults` — additive loadout entries composed into **every** agent ahead of its own loadout; see [Agent defaults](#agent-defaults) below.
- `harness_defaults` — native Pi, Claude Code, or Codex settings applied to every run of that harness; see [Harness defaults](#harness-defaults) below.

## Precedence

Higher wins:

1. `<project>/.agents/settings.local.yml`
2. `<project>/.agents/settings.yml`
3. `~/.agents/settings.local.yml`
4. `~/.agents/settings.yml`
5. Cached remote settings (in configured order)
6. Built-in defaults

Scalar settings override. `sources` follows last-wins ordering per scope so a higher-precedence file replaces the complete lower-precedence list. `workflows` and `agent_defaults` are additive ordered-set unions. `harness_defaults` deep-merges by harness, with higher-precedence leaves replacing lower-precedence leaves.

## Agent defaults

`agent_defaults` composes one set of additive loadout entries into every agent — local runs, Actions, and dumps alike — so an organization declares a shared extension, skill, MCP server, plugin, delegate, or appended prompt fragment once instead of duplicating it into every `agents/<id>/agent.md`:

```yaml
agent_defaults:
  extensions:
    - git:github.com/ai-outfitter/pensieve@4b1e0d2c9a7f35e86b0d1c4a92f6e3d5a8b7c601
  skills:
    - organization-practices
  mcp:
    - github
  plugins:
    - org-plugin
  subagents:
    - org-reviewer
  append_system_prompt:
    - file: prompts/organization.md # resolved like agent prompt sources: catalog `file`, active-project `repo_file`
```

Composition rules:

- Defaults compose **before** each agent's own loadout — like a root-most ancestor ahead of the whole inheritance chain — using the same deterministic parent-first ordering and stable de-duplication as inherited agent loadouts. An agent that lists the same slug itself never duplicates it, and the settings layer wins first-encounter conflicts.
- Selections resolve catalog-wide across layers, never through an agent's local namespace.
- Only the additive loadout fields above are supported. Per-agent controls such as `model`, `thinking`, and `tools` stay agent-owned; `agents.md` remains shared prompt context, not a configuration manifest.
- `outfitter run`, `outfitter dump`, and `outfitter validate` compose the same effective defaults. Unresolved references are validation findings and composition warnings named `agent_defaults …`, and `outfitter dump` records the settings-layer provenance in `.outfitter/composition.json` plus a `settings.yml` carrying the merged defaults, so a dumped tree stays self-contained.
- Settings without `agent_defaults` behave exactly as before. The block is backend-neutral: no backend-specific keys, endpoints, or credentials.

## Harness defaults

`harness_defaults` keeps organization- or project-wide native coding-harness policy beside the portable agent catalog without putting harness-specific keys in every agent profile:

```yaml
harness_defaults:
  pi:
    httpIdleTimeoutMs: 3600000
  claude:
    includeCoAuthoredBy: false
  codex:
    features:
      apps: false
```

The keys below each harness are passed through as that harness's native settings. `outfitter run` merges Pi and Claude defaults into its temporary `settings.json`; a Pi profile's own configuration overlay remains higher precedence. Codex receives flattened `--config key=TOML` arguments. `outfitter link` manages the same values individually in Pi or Claude `settings.json` and Codex `config.toml`, leaving every unrelated native setting untouched. An unmanaged value is never adopted or overwritten.

Every loaded settings scope may contribute defaults. Objects deep-merge from low to high precedence, while arrays and scalar leaves replace. `outfitter dump` carries the effective block into the dumped tree. Unknown harness names are rejected; supported names are `pi`, `claude`, and `codex`.
