# Iterating on an agent

This guide covers the edit-run-inspect loop for an [agent profile](./profiles.md): switching to an agent you can edit, iterating on its loadout and the resources it selects — locally or in a git worktree of a catalog — and verifying the result.

It is written for people and for Outfitter-managed agents — if you are an agent reading this, see [For Outfitter-managed agents](./local-development.md#for-outfitter-managed-agents) for how to improve the configuration you were launched with.

## Where editable resources live

Outfitter resolves resources from every configured layer. Two are directly editable on the current machine:

| Scope   | Resources            | Settings                                                  | Use for                                  |
| ------- | -------------------- | --------------------------------------------------------- | ---------------------------------------- |
| user    | `~/.agents/`         | `~/.agents/settings.yml` (+ `settings.local.yml`)         | Personal defaults shared across projects |
| project | `<project>/.agents/` | `<project>/.agents/settings.yml` (+ `settings.local.yml`) | Checked-in behavior the whole team gets  |

An agent and its loadout live in `agents/<id>/` in one of those layers. Machine-private launch choices — which agent runs by default, where sources resolve from — belong in the flat, gitignored `settings.local.yml` of either scope; it overlays its sibling with the same schema.

Resources synced from a remote catalog land in the Outfitter cache. Do not edit the cache — `outfitter sync` overwrites it. To iterate on a catalog resource, work in a local checkout of the catalog instead (see the worktree section below).

## Switching agents

- One launch: `outfitter run <id> [-- <agent args>]`
- Future launches: set `default_agent: <id>` in the settings scope you want it to apply to.
- List what is resolvable right now: `outfitter list agents`.
- Inspect synchronized profiles and adapter gaps: `outfitter profiles --json`.
- Within a compiled Pi session: `/outfitter profile <id>`.

`outfitter sync` fetches sources, compiles the enabled agents, and projects native profiles.
Use `outfitter sync --local` after editing to compile local and already-cached sources without fetching.
After synchronization, launches read that compiled snapshot, not the current source files.

Pi can switch between compatible compiled profiles at the next idle turn boundary while preserving
the conversation. Switching replaces the active prompt and selectors; it does not recompile edits.
Restart after compiling new source changes to load the new registry. Profiles share credentials,
environment, extensions, and operating-system authority: switching is not an isolation boundary.
Profiles with incompatible process-scoped extensions or native overlays require another launch.

## The iteration loop

1. Create or copy an experimental agent in a layer you can edit, and trim its loadout to what you are testing:

   ```
   <!-- .agents/agents/experiment/agent.md -->
   ---
   name: experiment
   description: Behavior I am trying out.
   skills: [wiki]
   model: gpt-5.2
   thinking: high
   ---

   <the behavior you are trying out>
   ```

   Point your next launch at it either way:

   ```yaml
   # .agents/settings.local.yml
   default_agent: experiment
   ```

2. Compile it with `outfitter sync --local`, then launch it with `outfitter run experiment`,
   or rely on the `default_agent` override above.

3. Validate before launching:

   ```sh
   outfitter validate --strict
   ```

   This reports protocol layout errors, unresolved loadout slugs, and broken skill references.

4. Inspect what the agent actually received:

   ```sh
   outfitter dump --agent experiment --out /tmp/inspect
   ```

   Diff dumps between iterations to inspect the current source composition. Run `sync --local`
   before launching so the compiled snapshot includes those edits.

5. Recompile, restart, and test the behavior, then fold the settled changes back into the agent or skill you were iterating on, and remove the experiment.

## Iterating on a catalog resource in a git worktree

Shared resources usually come from a [catalog](./catalogs.md) referenced as a pinned `github:` source. To change one:

1. Clone the catalog, or add a worktree to an existing clone so the iteration branch stays isolated:

   ```sh
   cd ~/repos/acme/agents-catalog/main
   git worktree add ../worktrees/feat/sharper-review-prompts -b feat/sharper-review-prompts
   ```

2. Point a machine-private source at the worktree in `settings.local.yml` (project or user scope):

   ```yaml
   # .agents/settings.local.yml
   sources:
     - path: ~/repos/acme/agents-catalog/worktrees/feat/sharper-review-prompts
   ```

3. Iterate with the loop above: edit in the worktree, `outfitter validate --strict`, relaunch, diff the dump.

4. Commit in the worktree, push, and open a pull request against the catalog. After it merges, remove the local `path:` override, bump the pinned `ref:`, run `outfitter sync`, and remove the worktree.

Because the override lives in `settings.local.yml`, teammates and CI keep resolving the published catalog while you iterate. This is the same trickle-up workflow as [Local development](./local-development.md), applied to one change.
