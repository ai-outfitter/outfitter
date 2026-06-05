# `native_fallback_cli_state`

This fixture models a normal user and repository profile selection where neither profile supplies adapter-native state under `cli_specific/pi/`.

## Setup

- `home/.bridl/settings.yml` sets `default` as the user's implicit profile and keeps Bridl's cache under the synthetic home tree.
- `home/.bridl/profiles/default/profile.yml` contributes personal default controls.
- `project/.bridl/settings.yml` exposes the user and project profile sources.
- `project/.bridl/profiles/fallback-review/profile.yml` is the selected project profile and contributes run-specific controls.

There are intentionally no `cli_specific/` directories in any profile. This forces the pi adapter to use native fallback locations for pi-owned state instead of treating profile folders as state owners.

## Expected behavior

Bridl should assemble a pi tack whose declared state paths are symlinks to pi's native user state under `home/.pi/agent/`, except for pi utility/bin state, which is owned by Bridl's cache under `home/.bridl/cache/utilities`.

If those native fallback files or directories do not already exist, tack materialization should create them before launching pi. The selected profile still resolves generic controls from the user default and project profile, with the project profile winning shared keys.

## Mutation/write-back behavior

Writes through declared symlinked state paths are owned by the native fallback locations and should persist there after the fake pi process exits. Generated Bridl tack files, such as `bridl/profile.json`, are temporary and must not rewrite source profile YAML. Undeclared pi writes in the tack should follow the adapter's `unknown` state policy and emit a warning without being persisted to a profile.
