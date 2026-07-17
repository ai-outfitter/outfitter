# Settings

Outfitter settings configure how resources are resolved and launched. They live inside the `.agents` tree so a tree carries everything it needs, and they are the only Outfitter-specific files in it — deleting them leaves a pure protocol payload.

Settings do not carry resource selections. An agent's loadout — its skills, subagents, model, and so on — lives on the [agent](./agents.md), not here. Settings is only about where resources come from and how a run launches.

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
default_harness: pi # which harness to launch: pi or claude

# Where protocol resources come from, beyond this tree and ~/.agents.
sources:
  - github: ai-outfitter/.agent # owner/repo shorthand
    ref: 2f9c1ab0d3e44b6f9d2c8a17e5b40c91d6f3a8e2 # pin a commit, tag, or branch
    # path: optional subdirectory containing the payload
  - uri: git+https://git.example.com/team/agents.git
    ref: v1.2.0
  - path: ../shared-agents # local directory, read live from disk

# Organization-distributed settings, layered below local settings.
remote_settings:
  - github: my-org/.outfitter
    path: .agents/settings.yml
    ref: 9c47d1e2b8a05f36c4d7e90a12b3f8c5d6e71a04

cache_directory: ~/.agents/cache
```

- `default_agent` / `default_harness` — which agent plain `outfitter` runs, and the harness it launches in.
- `sources` — ordered list of remote or local `.agents` payloads. Remote entries (`github:` / `uri:`) accept `ref:` pinning and an optional `path:` to the payload inside the repository; see [Catalogs](./catalogs.md) for conventions and trust guidance.
- `remote_settings` — shared settings a repository distributes; cached locally and merged below your project and user settings, so anything you set locally wins.
- `cache_directory` — where remote sources are cached (`outfitter sync` updates them).

## Precedence

Higher wins:

1. `<project>/.agents/settings.local.yml`
2. `<project>/.agents/settings.yml`
3. `~/.agents/settings.local.yml`
4. `~/.agents/settings.yml`
5. Cached remote settings (in configured order)
6. Built-in defaults

Scalar settings override; list-valued settings such as `sources` follow last-wins ordering per scope so a local file can reorder or replace where resources come from.
