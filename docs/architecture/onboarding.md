# Onboarding Architecture

## Purpose

Outfitter uses bundled Pi to host the same deterministic, polished setup walkthrough that existed
before the Dotagents refactor. Pi is the UI host, not necessarily the saved runtime: after the
original flow, one added selector chooses the default CLI agent and preselects Pi/Outfitter. Setup
requires no model credentials and sends no agent turn.

## Screen contract

The first prompt and its wording are fixed:

1. **Use the default Outfitter profile catalog**
2. **Create your own profile**
3. **Provide a different catalog to import**

The selected branch follows the original order:

- Default catalog: described profile picker (Founder first and recommended) → home/project target.
- Create: profile ID → profile label → home/project target.
- Different catalog: GitHub `owner/repo` → ref → settings path → private-catalog confirmation when
  applicable → home/project target.
- `outfitter setup [source]`: bypass the first prompt and begin at home/project target, matching the
  original provided-source path.

Exactly one screen is appended: **Which CLI agent should Outfitter use by default?** Pi/Outfitter is
the first, preselected recommendation; Claude Code is the other currently runnable adapter.

## Runtime flow

Both explicit `outfitter setup [source]` and implicit first-run `outfitter run` use one implementation:

1. Fetch `ai-outfitter/default-profiles` at the immutable Release Please tag shipped by this
   Outfitter version, or reuse that exact release from the normal `~/.agents/cache/repos` source
   cache, then read the current default marker. There is no sibling-checkout or packaged-catalog
   fallback.
2. Create an isolated Pi configuration and stamp paths, catalog metadata, optional source, and handoff
   location into the extension.
3. Start Pi offline without sessions, tools, skills, prompt templates, or provider credentials.
4. Auto-submit `/outfitter` and run the screen contract above through Pi UI APIs.
5. Write a small temporary JSON handoff and shut down the setup shell.
6. Validate the handoff and atomically apply it to `.agents`.
7. On implicit setup, re-resolve and launch; on explicit setup, report next-launch behavior.

The original `selectDescribedOption` component remains intact: selected-row descriptions, Up/Down,
Enter, Escape/Ctrl+C, recommended/current markers, and narrow-terminal wrapping are all covered by
tests and exercised through the generated extension.

## `.agents` persistence

The visible profile-era walkthrough is retained while storage is translated to the new model:

- `default_profile` becomes `default_agent`;
- the chosen CLI is stored as `default_harness`;
- home/project targets are `~/.agents/settings.yml` and `<project>/.agents/settings.yml`;
- a custom profile becomes `agents/<id>/agent.md` and never overwrites an existing file;
- the default catalog is recorded as `github: ai-outfitter/default-profiles` at the immutable
  Release Please version tag shipped by Outfitter; the bootstrap checkout remains derived cache
  data, not copied configuration;
- remote and provided catalogs retain their `remote_settings` outcome;
- private-catalog enablement uses `enterprise.private_catalogs` in home settings.

Writes use same-directory temporary files and rename. Cancellation writes no configuration (an exact
default-catalog cache may already have been warmed). On partial failure, only profile files and
private-catalog settings created or changed by that attempt are rolled back. If the pinned catalog
cannot be fetched and is not cached, setup fails before opening the walkthrough or changing settings.

## Deferred boundaries

General source refresh remains [#184](https://github.com/ai-outfitter/outfitter/issues/184).
Persistent harness projection, symlinking, and artifact baking remain
[#187](https://github.com/ai-outfitter/outfitter/issues/187). Setup does not port harness state or
create persistent links.
