# remote_baseline_local_selection

This fixture models a repository that has already synced a remote Bridl baseline into the user cache, then lets local settings choose the active profile while staying offline.

## Setup

- `home/.bridl/settings.yml` points at the cached `acme/bridl-baseline` remote settings source.
- `home/.bridl/cache/repos/.../settings/bridl.yml` represents the pre-seeded remote settings file that would normally be populated by `bridl sync`.
- `home/.bridl/cache/repos/.../profiles/` contains the matching pre-seeded remote profile source.
- `project/.bridl/settings.yml` is the checked-in project configuration.
- `project/.bridl/local/settings.yml` is developer-local configuration. It selects `local-selection` and repeats the resolved profile source list so the run does not require network access or mutation of checked-in project settings.

## Write-back behavior

The selected local profile owns `cli_specific/pi/settings.json`, so writes through the pi tack `settings.json` symlink should persist only to `project/.bridl/local/profiles/local-selection/cli_specific/pi/settings.json`. Generated tack files such as `bridl/profile.json` are transforms and should not write back to any profile source. Undeclared tack mutations should be reported as warnings and not persisted.

Expected tack summaries intentionally include `REMOTE_*`, `USER_*`, `PROJECT_*`, and `LOCAL_*` values so a failing test makes the winning input layer obvious.
