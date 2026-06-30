# `profile_owned_cli_state`

This fixture models a repository profile that owns selected agent CLI state alongside normal generic Outfitter controls.

## Setup

- `home/.outfitter/settings.yml` defines a personal `default` profile and native fallback cache location for the synthetic home tree.
- `project/.outfitter/settings.yml` declares the user profile source first and the repository profile source second.
- `project/.outfitter/profiles/team-base/profile.yml` contributes shared repository controls inherited by the selected profile.
- `project/.outfitter/profiles/team-base/cli_specific/pi/.mcp.json` contributes an inherited Pi MCP config fragment.
- `project/.outfitter/profiles/stateful-review/profile.yml` is the selected profile.
  It includes generic controls plus `controls.pi` and `controls.claude` adapter-specific overrides.
- `project/.outfitter/profiles/stateful-review/cli_specific/pi/` contains Pi-owned state files such as `auth.json`, `settings.json`, `mcp.json`, and `plugins/`, plus a selected-profile `.mcp.json` MCP config fragment.
- `project/.outfitter/profiles/stateful-review/cli_specific/claude/` contains Claude-owned state files such as `settings.json`, `agents/`, `commands/`, `skills/`, and `plugins/`.

## Expected behavior

Running the selected `stateful-review` profile should compose the inherited `team-base` profile and the selected repository profile; the configured user `default` profile is not included because the run selects `stateful-review` explicitly.
Generic controls should be present for both adapters, while each adapter should merge its own adapter-specific control block before launch.

Adapter-declared state paths that exist under the selected profile's `cli_specific/<adapter>/` directory should be symlinked into the temporary composite profile from that profile-owned state.
Pi `.mcp.json` fragments from inherited and selected profile folders should be merged into a generated composite `.mcp.json` file rather than treated as durable symlinked state.
State paths not present in the selected profile remain native or cache-backed fallbacks.

## Mutation/write-back behavior

Tests mutate declared state paths through the composite profile symlinks.
Those writes should update only the selected profile-owned state for the adapter being run.
Pi writes must not touch Claude profile-owned files, and Claude writes must not touch Pi profile-owned files.
Generated composite profile files such as `outfitter/profile.json` remain temporary transforms and should not rewrite source profile YAML.
