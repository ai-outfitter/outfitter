# remote_baseline_local_selection

This fixture models a repository that has already synced a remote ApplePi baseline into the user cache, then lets local settings choose the active profile while staying offline.

## Setup

- `home/.applepi/settings.yml` points at the cached `acme/applepi-baseline` remote settings source.
- `home/.applepi/cache/repos/.../settings/applepi.yml` represents the pre-seeded remote settings file that would normally be populated by `applepi sync`.
- `home/.applepi/cache/repos/.../profiles/` contains the matching pre-seeded remote profile source.
- `project/.applepi/settings.yml` is the checked-in project configuration.
- `project/.applepi/local/settings.yml` is developer-local configuration.
  It selects `local-selection` and repeats the resolved profile source list so the run does not require network access or mutation of checked-in project settings.

## Write-back behavior

The selected local profile owns `cli_specific/pi/settings.json`, so writes through the pi composite profile `settings.json` symlink should persist only to `project/.applepi/local/profiles/local-selection/cli_specific/pi/settings.json`.
Generated composite profile files such as `applepi/profile.json` are transforms and should not write back to any profile source.
Undeclared composite profile mutations should be reported as warnings and not persisted.

Expected composite profile summaries intentionally include `REMOTE_*`, `USER_*`, `PROJECT_*`, and `LOCAL_*` values so a failing test makes the winning input layer obvious.
