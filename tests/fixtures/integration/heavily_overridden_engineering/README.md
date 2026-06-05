# heavily_overridden_engineering

This fixture models a real engineering profile that is intentionally defined in many places at once.
It is agent-neutral at the directory level, while individual profiles may include adapter-specific controls and `cli_specific/` state for adapters that support them.

The selected profile id is `engineering`.
Profile source order is arranged from lowest to highest precedence:

1. a pre-seeded cached GitHub/team source in `home/.applepi/cache/repos/`;
2. a repo-declared supplemental team source at `project/.applepi/team-profiles/`;
3. the user's profile source at `home/.applepi/profiles/`;
4. the checked-in repository source at `project/.applepi/profiles/`;
5. project-local overrides at `project/.applepi/local/profiles/`.

Each layer contributes obvious environment values such as `REMOTE_ONLY`, `USER_ONLY`, `REPO_ONLY`, `LOCAL_ONLY`, and `SHARED` so a failed assertion points directly at the wrong winning layer.
The project-local `engineering` layer also inherits `team-baseline`, while the user `default` profile is included implicitly below the selected profile.

## Write-back behavior

The project-local `engineering` profile owns `cli_specific/pi/settings.json`, which is the highest-precedence profile-owned Pi state file for that declared state path.
Writes through the generated composite profile's `settings.json` symlink should update only that project-local file.

Generated ApplePi files such as `applepi/profile.json` are transform outputs and are not written back to any source profile.
Undeclared files created in the composite profile should produce warnings and should not be persisted to any fixture source layer.
