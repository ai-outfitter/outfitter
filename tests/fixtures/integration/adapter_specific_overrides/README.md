# `adapter_specific_overrides`

This fixture models one repository-selected profile that combines portable Outfitter controls with adapter-specific overrides for both pi and Claude Code.

## Setup

- `home/.outfitter/settings.yml` defines the user's `default` profile and uses pi as the user default agent.
- `home/.outfitter/profiles/default/profile.yml` contributes personal environment defaults below the selected repository profile.
- `project/.outfitter/settings.yml` declares both the synthetic user profile source and the repository profile source.
- `project/.outfitter/profiles/adapter-review/profile.yml` defines generic controls plus `controls.pi` and `controls.claude` overrides.
- `project/.outfitter/profiles/adapter-review/cli_specific/pi/settings.json` and `cli_specific/claude/settings.json` are profile-owned state files for their respective adapters.

## Expected behavior

Running the same selected profile as pi should launch `pi` with generic controls overlaid by `controls.pi`: pi-specific scalar controls, args, and environment should win over shared generic values, while extension and skill resources should merge with adapter-specific resources first.
Running it as Claude Code should launch `claude` with generic controls overlaid by `controls.claude`: Claude-specific scalar controls, args, and environment should win over shared generic values, while plugin directories should merge with Claude-specific resources first.

Both adapters should resolve only the selected repository profile and its explicit inheritance chain; user defaults should not be implicitly composed.
Each adapter should select only its own `cli_specific/<adapter>/settings.json` as the declared state target.

## Mutation/write-back behavior

Integration tests mutate generated composite profile content, the adapter-owned `settings.json`, and an undeclared composite profile file from a fake launcher.
Mutating generated `outfitter/profile.json` must not rewrite any source profile YAML.
Mutating an adapter `settings.json` must write through only to that adapter's profile-owned state file.
Undeclared composite profile writes should produce the adapter's unknown-state warning and should not be persisted outside the temporary composite profile.
