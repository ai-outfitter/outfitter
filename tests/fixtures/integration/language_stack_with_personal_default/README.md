# `language_stack_with_personal_default`

This fixture models a realistic TypeScript repository profile that composes checked-in language and tooling profiles with the user's implicit personal `default` profile.

## Setup

- `home/.applepi/settings.yml` declares the personal `default` profile, the `pi` default agent, and a user cache directory.
- `home/.applepi/profiles/default/profile.yml` contributes personal environment and session defaults that should sit below all repository profiles.
- `project/.applepi/settings.yml` exposes both the synthetic user profile source and the checked-in repository profile source.
- `project/.applepi/profiles/repo-review-base/profile.yml` contains shared review conventions for the repository.
- `project/.applepi/profiles/language-typescript/profile.yml` inherits the review base and adds TypeScript-specific controls.
- `project/.applepi/profiles/tooling-node-vitest/profile.yml` inherits the review base and adds Node/Vitest tooling controls.
- `project/.applepi/profiles/typescript-review/profile.yml` inherits the language and tooling profiles and is selected by the integration test.

## Expected behavior

When the test selects `typescript-review`, ApplePi should first include the user's implicit `default` profile, then resolve the repository inheritance stack.
Repository controls win overlapping environment keys while preserving lower-precedence personal values that are not overridden.

The resulting pi launch plan should include the selected model, prompt controls, inherited environment variables, and the selected profile's final review argument.

## Mutation/write-back behavior

This fixture intentionally omits `cli_specific/<adapter>/` state files.
Adapter-declared state should therefore resolve to native or cache fallback paths, not to parent profiles in the inheritance stack.

Tests may mutate generated composite profile files, fallback state, and unknown composite profile paths.
Generated composite profile mutations must not be written back to any inherited repository profile or to the user profile YAML.
Unknown writes should follow the adapter's `unknown` state policy.
