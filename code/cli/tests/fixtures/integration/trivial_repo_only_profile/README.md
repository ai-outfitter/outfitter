# `trivial_repo_only_profile`

This fixture models the ordinary case where a repository contributes one checked-in profile and the user has a normal personal `default` profile.

## Setup

- `home/.outfitter/settings.yml` defines the user default profile as `default`.
- `home/.outfitter/profiles/default/profile.yml` contributes personal defaults such as `USER_DEFAULT` environment values.
- `project/.outfitter/settings.yml` declares the profile sources needed for this synthetic test tree: the user profile source and the repo profile source.
- `project/.outfitter/profiles/repo-review/profile.yml` defines the selected repository profile.

The test selects `repo-review` explicitly, so Outfitter should resolve the user's `default` profile as the implicit lower-precedence profile and then layer `repo-review` above it.

## Expected behavior

The selected profile should contain both user-default and repo-specific controls, with repo values winning shared keys.

This fixture intentionally does not provide any `cli_specific/<adapter>/` state files.
Adapter-declared persistent state should therefore use each adapter's native fallback or configured cache behavior rather than writing state into the repo profile.

## Mutation/write-back behavior

Tests may mutate generated composite profile files and unknown user-write paths from the fake launcher.
Generated composite profile mutations must not rewrite source settings or profile YAML.
Unknown writes should be handled by the selected adapter's `unknown` state policy.
