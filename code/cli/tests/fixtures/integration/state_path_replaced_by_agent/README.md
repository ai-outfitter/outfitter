# state_path_replaced_by_agent

This fixture models a project profile with persistent pi state owned by the profile folder.
The selected `state-replacement` profile declares durable symlink-backed state for `settings.json` and `sessions/`, and seeds both paths under `project/.outfitter/profiles/state-replacement/cli_specific/pi/`.

## Setup

- `home/.outfitter/settings.yml` defines the personal `default` profile and pi as the default agent.
- `project/.outfitter/settings.yml` composes the user profile source with the project profile source.
- `project/.outfitter/profiles/state-replacement/profile.yml` selects explicit symlink persistence for `settings.json` and `sessions/`.

## Write-back behavior

A real child CLI should write through the symlinks, which would update the profile-owned files.
The integration test's fake launcher intentionally does the wrong thing: it unlinks the composite profile symlinks and replaces them with a regular file and a regular directory.
Outfitter must diagnose those replacements as not persisted, and the original profile-owned source file and directory contents must remain unchanged.
