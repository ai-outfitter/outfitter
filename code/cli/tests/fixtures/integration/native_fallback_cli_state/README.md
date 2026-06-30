# `native_fallback_cli_state`

This fixture models a normal user and repository profile selection where neither profile supplies adapter-native state under `cli_specific/pi/`.

## Setup

- `home/.outfitter/settings.yml` sets `default` as the user's implicit profile and keeps Outfitter's cache under the synthetic home tree.
- `home/.outfitter/profiles/default/profile.yml` contributes personal default controls.
- `project/.outfitter/settings.yml` exposes the user and project profile sources.
- `project/.outfitter/profiles/fallback-review/profile.yml` is the selected project profile and contributes run-specific controls.
- `home/.pi/agent/keybindings.json` seeds native Pi keybindings so the fixture can prove Outfitter generates a runtime keybinding transform without overwriting the native source.
- `home/.pi/agent/models.json` seeds native Pi model/provider definitions so the fixture can prove native model state is visible in the composite profile before launch.
- `project/.outfitter/profiles/fallback-review/skills/review-skill/SKILL.md` contributes a profile-bundled Agent Skill that should become a Pi `--skill` argument.
- `project/.outfitter/profiles/fallback-review/deepwork/jobs/review_job/job.yml` contributes a profile-bundled DeepWork job folder that should become `DEEPWORK_ADDITIONAL_JOBS_FOLDERS`.

There are intentionally no `cli_specific/` directories in any profile.
This forces the pi adapter to use native fallback locations for pi-owned state instead of treating profile folders as state owners.

## Expected behavior

Outfitter should assemble a pi composite profile whose declared state paths are symlinks to pi's native user state under `home/.pi/agent/`, including pi runtime `tmp/` state, except for generated runtime `keybindings.json` and pi utility/bin state.
The generated runtime keybindings file should reserve `Shift+Tab` for Outfitter mode switching, preserve non-conflicting native bindings, and remain non-durable; native `models.json` should remain available through the composite profile; profile skills and DeepWork jobs should be exposed through Pi launch arguments/environment; utility/bin state is owned by Outfitter's cache under `home/.outfitter/cache/utilities`.

If native fallback files or directories for symlinked state do not already exist, composite profile materialization should create them before launching pi.
Because the run selects `fallback-review` explicitly, the configured user default profile is not composed; the selected project profile supplies the generic controls for the launch.

## Mutation/write-back behavior

Writes through declared symlinked state paths are owned by the native fallback locations and should persist there after the fake pi process exits.
Generated Outfitter composite profile files, such as `outfitter/profile.json` and runtime `keybindings.json`, are temporary and must not rewrite source profile YAML or native keybinding JSON.
Undeclared pi writes in the composite profile should follow the adapter's `unknown` state policy and emit a warning without being persisted to a profile.
