# Local dotagents development

The recommended way to develop agent configuration is a **personal standalone `.agents` repository** — a repo whose root is the protocol payload (for example [`ncrmro/.agents`](https://github.com/ncrmro/.agents)). You iterate there with full git history, point your machine at local checkouts while you work, and open pull requests to move settled improvements upstream into shared catalogs. Changes trickle up instead of living forever in one person's home directory.

## The repository

```text
ncrmro/.agents/
  agents.md
  agents/
    founder/agent.md
    engineer/agent.md
  skills/
  tasks/
  settings.yml           # committed: pinned upstream sources, named profiles
  settings.local.yml     # gitignored: this machine's overrides
  .gitignore             # settings.local.yml, *.generated-*
```

Clone it as your global layer, or point your user settings at the checkout:

```bash
git clone git@github.com:ncrmro/.agents.git ~/.agents
```

## Committed settings: pin upstream

The committed `settings.yml` consumes shared catalogs **pinned to exact commits**, so the repository is reproducible on any machine:

```yaml
# settings.yml (committed)
default_profile: founder

sources:
  - github: ai-outfitter/.agent
    ref: 2f9c1ab0d3e44b6f9d2c8a17e5b40c91d6f3a8e2
  - github: ai-outfitter/community-profiles
    ref: 8d04c7a1f2e94b3c6a5d80e17f4b29c3d1e6a075
  - path: . # this repository's own resources win last
```

Bumping a pin is an ordinary reviewed commit: sync, diff the upstream change, update the SHA.

## Local settings: point at checkouts

When you are changing an upstream catalog itself, override its source in the gitignored `settings.local.yml` to an absolute path of your local checkout:

```yaml
# settings.local.yml (gitignored — machine-specific absolute paths)
sources:
  - path: /home/ncrmro/repos/unsupervised/ai-outfitters/default-profiles
  - path: /home/ncrmro/repos/unsupervised/ai-outfitters/worktrees/actions/main
  - path: /home/ncrmro/repos/ncrmro/.agents
```

Because `settings.local.yml` overlays its sibling with higher [precedence](./settings.md#precedence), your machine resolves live working trees while every other consumer of the repo keeps resolving the pinned SHAs. Worktrees keep an iteration branch isolated:

```sh
cd ~/repos/acme/agents-catalog/main
git worktree add ../worktrees/feat/sharper-review -b feat/sharper-review
```

## The loop

1. Edit resources — an `agent.md`, a skill, a task — in whichever checkout owns them.
2. Validate: `outfitter validate --strict`.
3. Inspect what a run would actually receive: `outfitter dump --profile founder --out /tmp/inspect` and diff between iterations.
4. Relaunch `outfitter` and test the behavior (a running session keeps the composition it started with).
5. Fold settled changes back to their home:
   - personal → commit to your `.agents` repo;
   - shared → commit in the upstream checkout, push, and open a PR against the catalog (`ai-outfitter/default-profiles`, `ai-outfitter/actions`, your org's `.outfitter`, …).
6. After the upstream PR merges: remove the local `path:` override, bump the pinned `ref:` in `settings.yml`, and `outfitter sync`.

## Consuming your repo from projects

A project that wants your personal layer doesn't need anything special — `~/.agents` _is_ the global layer. For project-specific wiring, a project's `.agents/settings.local.yml` can also point a source at your checkout, keeping teammates and CI on the published pins while you iterate.

## For Outfitter-managed agents

If you are an agent launched by Outfitter, your instructions, skills, and subagents came from resolved `.agents` layers, and you can improve them like code — the change takes effect for future sessions, never the current one:

1. `outfitter list` shows each resolved resource and its winning source.
2. Never edit the sync cache — it is overwritten. Edit the checkout the source points at, or the user/workspace layer that shadows it.
3. Make the smallest change that captures the improvement, run `outfitter validate --strict`, and tell the user what you changed, why, and that it applies on restart.
4. Put team-relevant changes in the upstream catalog through a pull request; keep personal or experimental changes in the personal repo or `settings.local.yml` scope.
