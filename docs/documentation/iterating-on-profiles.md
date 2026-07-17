# Iterating on profiles

This guide covers the edit-run-inspect loop for compositions: switching to a profile you can edit, iterating on the resources it selects — locally or in a git worktree of a catalog — and verifying the result.

It is written for people and for Outfitter-managed agents — if you are an agent reading this, see [For Outfitter-managed agents](./local-development.md#for-outfitter-managed-agents) for how to improve the configuration you were launched with.

## Where editable resources live

Outfitter resolves resources from every configured layer. Two are directly editable on the current machine:

| Scope   | Resources               | Settings                                                       | Use for                                  |
| ------- | ----------------------- | -------------------------------------------------------------- | ---------------------------------------- |
| user    | `~/.agents/`            | `~/.agents/settings.yml` (+ `settings.local.yml`)              | Personal defaults shared across projects |
| project | `<project>/.agents/`    | `<project>/.agents/settings.yml` (+ `settings.local.yml`)      | Checked-in behavior the whole team gets  |

Machine-private experiments belong in the flat, gitignored `settings.local.yml` of either scope — it overlays its sibling with the same schema, so you can redefine profiles or repoint `sources` without touching committed files.

Resources synced from a remote catalog land in the Outfitter cache. Do not edit the cache — `outfitter sync` overwrites it. To iterate on a catalog resource, work in a local checkout of the catalog instead (see the worktree section below).

## Switching profiles

- One launch: `outfitter run --profile <id> [-- <agent args>]`
- Future launches: set `default_profile: <id>` in the settings scope you want it to apply to.
- List what is resolvable right now: `outfitter list profiles`.

Changes apply on the next launch. A running session keeps the baked composition it started with, so after editing you must restart `outfitter` to load the result.

## The iteration loop

1. Declare an experimental profile in `settings.local.yml`, layering a trial persona over an existing selection:

   ```yaml
   # .agents/settings.local.yml
   default_profile: my-experiment
   profiles:
     my-experiment:
       personas: [engineer, experiment] # experiment layers over engineer
       skills: [wiki]
   ```

   with the trial behavior in a workspace agent:

   ```markdown
   <!-- .agents/agents/experiment/agent.md -->
   ---
   name: experiment
   description: Behavior I am trying out.
   ---

   <the behavior you are trying out>
   ```

2. Point your next launch at it: `outfitter run --profile my-experiment`, or rely on the `default_profile` override above.

3. Validate before launching:

   ```sh
   outfitter validate --strict
   ```

   This reports protocol layout errors, unresolved slugs in selections, and broken skill references.

4. Inspect what the agent actually received:

   ```sh
   outfitter dump --profile my-experiment --out /tmp/inspect
   ```

   Diff dumps between iterations to confirm a change landed — the dump is exactly what run composes.

5. Restart and test the behavior, then fold the settled changes back into the persona or skill the experiment layered over, and remove the experiment entries.

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
