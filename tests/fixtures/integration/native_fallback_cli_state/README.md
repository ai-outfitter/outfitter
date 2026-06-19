# `native_fallback_cli_state`

This fixture models a normal user and repository profile selection where neither profile supplies adapter-native state under `cli_specific/pi/`.

## Setup

- `home/.outfitter/settings.yml` sets `default` as the user's implicit profile and keeps Outfitter's cache under the synthetic home tree.
- `home/.outfitter/profiles/default/profile.yml` contributes personal default controls.
- `project/.outfitter/settings.yml` exposes the user and project profile sources.
- `project/.outfitter/profiles/fallback-review/profile.yml` is the selected project profile and contributes run-specific controls.

There are intentionally no `cli_specific/` directories in any profile.
This forces the pi adapter to use native fallback locations for pi-owned state instead of treating profile folders as state owners.

## Expected behavior

Outfitter should assemble a pi composite profile whose declared state paths are symlinks to pi's native user state under `home/.pi/agent/`, including pi runtime `tmp/` state, except for pi utility/bin state, which is owned by Outfitter's cache under `home/.outfitter/cache/utilities`.

If those native fallback files or directories do not already exist, composite profile materialization should create them before launching pi.
The selected profile still resolves generic controls from the user default and project profile, with the project profile winning shared keys.

## Mutation/write-back behavior

Writes through declared symlinked state paths are owned by the native fallback locations and should persist there after the fake pi process exits.
Generated Outfitter composite profile files, such as `outfitter/profile.json`, are temporary and must not rewrite source profile YAML.
Undeclared pi writes in the composite profile should follow the adapter's `unknown` state policy and emit a warning without being persisted to a profile.
