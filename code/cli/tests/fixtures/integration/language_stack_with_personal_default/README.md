# `language_stack_with_personal_default`

This fixture models a realistic TypeScript repository profile that composes checked-in language and tooling profiles while keeping the user's personal `default` profile separate unless it is selected or explicitly inherited.

## Setup

- `home/.outfitter/settings.yml` declares the personal `default` profile, the `pi` default agent, and a user cache directory.
- `home/.outfitter/profiles/default/profile.yml` contributes personal environment, prompt, and argument defaults only for default-profile launches or profiles that explicitly inherit it.
- `project/.outfitter/settings.yml` exposes both the synthetic user profile source and the checked-in repository profile source.
- `project/.outfitter/profiles/repo-review-base/profile.yml` contains shared review conventions for the repository, including an appended system prompt.
- `project/.outfitter/profiles/language-typescript/profile.yml` inherits the review base and adds TypeScript-specific controls plus its own appended system prompt.
- `project/.outfitter/profiles/tooling-node-vitest/profile.yml` inherits the review base and adds Node/Vitest tooling controls.
- `project/.outfitter/profiles/typescript-review/profile.yml` inherits the language and tooling profiles and is selected by the integration test.

## Expected behavior

When the test selects `typescript-review`, Outfitter should resolve only that profile and its repository inheritance stack.
Repository controls should not pick up personal default-profile values unless the selected profile explicitly inherits them.

The resulting pi launch plan should include the selected model, prompt controls, composed appended system prompts, inherited environment variables, and the selected profile's final review argument.

## Mutation/write-back behavior

This fixture intentionally omits `cli_specific/<adapter>/` state files.
Adapter-declared state should therefore resolve to native or cache fallback paths, not to parent profiles in the inheritance stack.

Tests may mutate generated composite profile files, fallback state, and unknown composite profile paths.
Generated composite profile mutations must not be written back to any inherited repository profile or to the user profile YAML.
Unknown writes should follow the adapter's `unknown` state policy.
