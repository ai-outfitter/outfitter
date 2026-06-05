# `adapter_specific_overrides`

This fixture models one repository-selected profile that combines portable Bridl controls with adapter-specific overrides for both pi and Claude Code.

## Setup

- `home/.bridl/settings.yml` defines the user's `default` profile and uses pi as the user default agent.
- `home/.bridl/profiles/default/profile.yml` contributes personal environment defaults below the selected repository profile.
- `project/.bridl/settings.yml` declares both the synthetic user profile source and the repository profile source.
- `project/.bridl/profiles/adapter-review/profile.yml` defines generic controls plus `controls.pi` and `controls.claude` overrides.
- `project/.bridl/profiles/adapter-review/cli_specific/pi/settings.json` and `cli_specific/claude/settings.json` are profile-owned state files for their respective adapters.

## Expected behavior

Running the same selected profile as pi should launch `pi` with generic controls overlaid by `controls.pi`: pi-specific model, thinking, provider, prompt template, skills, args, and environment should win over shared generic values. Running it as Claude Code should launch `claude` with generic controls overlaid by `controls.claude`: Claude-specific model, thinking, system prompts, args, plugin directories, and environment should win over shared generic values.

Both adapters should still receive the user's implicit default environment below the repository profile. Each adapter should select only its own `cli_specific/<adapter>/settings.json` as the declared state target.

## Mutation/write-back behavior

Integration tests mutate generated tack content, the adapter-owned `settings.json`, and an undeclared tack file from a fake launcher. Mutating generated `bridl/profile.json` must not rewrite any source profile YAML. Mutating an adapter `settings.json` must write through only to that adapter's profile-owned state file. Undeclared tack writes should produce the adapter's unknown-state warning and should not be persisted outside the temporary tack.
