# Iterating on local and worktree profiles

This guide covers the edit-run-inspect loop for profiles: switching to a profile you can edit, iterating on it locally or in a git worktree of a profile catalog, and verifying the result.
It is written for people and for Outfitter-managed agents — if you are an agent reading this, the "Improving your own profile" section describes how to modify the profile you were launched with.

## Where editable profiles live

Outfitter resolves profiles from every configured `profile_sources` entry.
Three scopes are directly editable on the current machine:

| Scope         | Profiles                               | Settings                                  | Use for                                   |
| ------------- | -------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| user          | `~/.outfitter/profiles/`               | `~/.outfitter/settings.yml`               | Personal defaults shared across projects  |
| project       | `<project>/.outfitter/profiles/`       | `<project>/.outfitter/settings.yml`       | Checked-in behavior the whole team gets   |
| project-local | `<project>/.outfitter/local/profiles/` | `<project>/.outfitter/local/settings.yml` | Machine-private overrides and experiments |

Profiles synced from a remote catalog (`github:` or `uri:` profile sources) land in the Outfitter cache.
Do not edit the cache — `outfitter sync` overwrites it.
To iterate on a catalog profile, work in a local checkout of the catalog instead (see the worktree section below).

## Switching profiles

- One launch: `outfitter run --profile <id> [-- <agent args>]`
- Future launches: set `default_profile: <id>` in the settings scope you want it to apply to.
- List what is resolvable right now: `outfitter profile list` (add `--all` to include inheritance-only templates).

Profile changes apply on the next launch.
A running session keeps the composite profile it started with, so after editing a profile you must restart `outfitter` to load the result.

## The iteration loop

1. Create or locate an editable profile:

   ```sh
   outfitter profile create my_experiment --scope project-local
   ```

To iterate on an existing profile without touching it, create a new profile that inherits from it:

```yaml
# .outfitter/local/profiles/my_experiment/profile.yml
id: my_experiment
label: My Experiment
inherits:
  - engineer
controls:
  append_system_prompt:
    - |
      <the behavior you are trying out>
```

2. Point your next launch at it, either with `outfitter run --profile my_experiment` or by setting `default_profile: my_experiment` in `.outfitter/local/settings.yml`.

3. Validate before launching:

   ```sh
   outfitter profile lint --strict
   ```

This reports schema and inheritance errors, missing typed prompt include files, and raw append-prompt strings that look like file paths.

4. Inspect what the agent actually received.
   With `profile_export: true` in the active settings, Outfitter writes the composed system prompt next to the profile (`generated-system-prompt.md` in a directory profile, `<id>.generated-system-prompt.md` beside a flat profile).
   Diff it between iterations to confirm a change landed.

5. Restart and test the behavior, then fold the settled changes back into the profile the experiment inherited from.

## Iterating on a catalog profile in a git worktree

Shared profiles usually come from a catalog repository (see [Profile repositories](./profile-repository.md)) referenced as a `github:` source.
To change one:

1. Clone the catalog, or add a worktree to an existing clone so the iteration branch stays isolated:

   ```sh
   cd ~/repos/acme/profile-catalog/main
   git worktree add ../worktrees/feat/sharper-review-prompts -b feat/sharper-review-prompts
   ```

2. Point a machine-private profile source at the worktree in `.outfitter/local/settings.yml` (or `~/.outfitter/settings.yml`).
   Local `path:` sources take the same layout as the catalog:

   ```yaml
   # .outfitter/local/settings.yml
   profile_sources:
     - path: ~/repos/acme/profile-catalog/worktrees/feat/sharper-review-prompts/profiles
   ```

3. Iterate with the loop above: edit in the worktree, `outfitter profile lint --strict`, relaunch, inspect the prompt export.

4. Commit in the worktree, push, and open a pull request against the catalog.
   After it merges, remove the local `path:` override, run `outfitter sync` to refresh the cached catalog, and remove the worktree.

Because the override lives in project-local settings, teammates and CI keep resolving the published catalog while you iterate.

## Improving your own profile (for Outfitter-managed agents)

If you are an agent launched by Outfitter, your instructions, tools, skills, and extensions came from a profile, and you can improve that profile the same way you improve code — but the change only takes effect for future sessions, never the current one.

1. Identify your active profile.
   The launch header and `outfitter profile list` show profile ids; your composite profile directory contains `outfitter/profile.json` with the id, label, and merged controls you were launched with.
2. Find the editable source for that profile with the scope table above.
   If the profile comes from a remote catalog, do not edit the cache — use the worktree flow above, or create a local profile that `inherits` from it and layer the improvement on top.
3. Make the smallest change that captures the improvement: a new `append_system_prompt` entry for a behavior correction, a `skills` entry for a reusable procedure, or a control override (model, thinking level, environment) for launch mechanics.
4. Validate with `outfitter profile lint --strict`, and review the `profile_export` prompt output when prompt text changed.
5. Tell the user what you changed and why, and that the change applies when they restart `outfitter` (or launch `outfitter run --profile <id>`).
   You cannot reload your own profile mid-session.

Prefer durable, reviewable improvements: put team-relevant changes in the project or catalog profile through a pull request, and keep personal or experimental changes in user or project-local scope.
