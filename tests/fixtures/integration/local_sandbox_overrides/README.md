# `local_sandbox_overrides`

This fixture models a developer who keeps stable repository profiles checked in, then selects a local-only sandbox without editing those checked-in files.

## Setup

- `home/.bridl/settings.yml` defines normal user defaults and a personal profile source.
- `project/.bridl/settings.yml` is the checked-in project configuration. It selects `repo-review` and exposes the checked-in project profiles.
- `project/.bridl/profiles/typescript-base/profile.yml` and `project/.bridl/profiles/repo-review/profile.yml` are stable repository profiles.
- `project/.bridl/local/settings.yml` is a local override. It selects `local-sandbox` and explicitly lists user, checked-in project, and local profile sources so the local profile can inherit the repository profile stack.
- `project/.bridl/local/profiles/local-sandbox/profile.yml` adds experimental sandbox controls and state-persistence overrides.

## Expected behavior

Running without an explicit `--profile` should use the project-local `default_profile: local-sandbox`. The resolved profile should include the inherited repository review controls plus local sandbox overrides such as an experimental environment variable, a sandbox prompt, and pi-specific launch flags.

## Mutation/write-back behavior

The local sandbox deliberately makes selected pi state temporary:

- `settings.json: warn` allows settings experiments in the tack, reports them after exit, and does not update native pi settings or checked-in profile files.
- `cache/` and `sessions/` use `discard`, so fake cache and session writes are thrown away silently with the tack.
- `unknown: discard` keeps miscellaneous sandbox writes local to the tack without warning.

Tests mutate the generated tack from the fake launcher and then verify that checked-in project profiles and local profile YAML remain unchanged.
