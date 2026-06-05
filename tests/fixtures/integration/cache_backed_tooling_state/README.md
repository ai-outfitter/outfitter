# `cache_backed_tooling_state`

This fixture models a project that wants reusable agent tooling to survive across Bridl's temporary tacks without being written back into user or repository profile folders.

## Setup

- `home/.bridl/settings.yml` provides a normal user default profile and default `pi` agent selection.
- `home/.bridl/profiles/default/profile.yml` contributes personal defaults below the selected project profile.
- `project/.bridl/settings.yml` includes both the user and project profile sources and configures `cache_directory: ../../cache`.
- `project/.bridl/local/settings.yml` repeats the same fixture-level cache directory from the local-settings location to model an explicit developer-local cache setting without changing profile YAML.
- `project/.bridl/profiles/cache-tooling/cli_specific/pi/` includes profile-owned `utilities/` and `bin/` directories on purpose. The pi adapter should ignore those for reusable tooling paths because `utilities/` and `bin/` are cache-backed.

## Expected behavior

The selected `cache-tooling` profile should merge over the user default and launch pi with `PI_CODING_AGENT_DIR` pointing at the temporary tack. Pi's reusable tooling paths, `utilities/` and `bin/`, should both symlink to the configured fixture cache directory (`cache/utilities`) so repeated tacks reuse the same installed helpers.

Other adapter-declared state such as `cache/`, `npm/`, and `git/` remains governed by normal pi state-source resolution. This fixture only asserts the cache-backed reusable tooling paths.

## Mutation/write-back behavior

Tests write through the tack `utilities/` and `bin/` symlinks. Those writes must persist under `cache/utilities` and must not appear under `home/.pi/agent/`, `home/.bridl/profiles/`, or `project/.bridl/profiles/`. Generated tack files and source profile YAML must remain unchanged.
