# `native_fallback_cli_state`

This fixture models a normal user and repository profile selection where neither profile supplies adapter-native state under `cli_specific/pi/`.

## Setup

- `home/.applepi/settings.yml` sets `default` as the user's implicit profile and keeps ApplePi's cache under the synthetic home tree.
- `home/.applepi/profiles/default/profile.yml` contributes personal default controls.
- `project/.applepi/settings.yml` exposes the user and project profile sources.
- `project/.applepi/profiles/fallback-review/profile.yml` is the selected project profile and contributes run-specific controls.

There are intentionally no `cli_specific/` directories in any profile.
This forces the pi adapter to use native fallback locations for pi-owned state instead of treating profile folders as state owners.

## Expected behavior

ApplePi should assemble a pi composite profile whose declared state paths are symlinks to pi's native user state under `home/.pi/agent/`, except for pi utility/bin state, which is owned by ApplePi's cache under `home/.applepi/cache/utilities`.

If those native fallback files or directories do not already exist, composite profile materialization should create them before launching pi.
The selected profile still resolves generic controls from the user default and project profile, with the project profile winning shared keys.

## Mutation/write-back behavior

Writes through declared symlinked state paths are owned by the native fallback locations and should persist there after the fake pi process exits.
Generated ApplePi composite profile files, such as `applepi/profile.json`, are temporary and must not rewrite source profile YAML.
Undeclared pi writes in the composite profile should follow the adapter's `unknown` state policy and emit a warning without being persisted to a profile.
