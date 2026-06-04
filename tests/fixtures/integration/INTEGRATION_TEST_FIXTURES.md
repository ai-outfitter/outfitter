# Integration Test Fixture Catalog

This catalog has two groups:

1. Existing small profile-resolution fixtures already under `tests/fixtures/scenarios/`.
2. Full-directory integration fixtures for tack generation and state persistence under `tests/fixtures/integration/`, including implemented and planned scenarios.

Integration fixture names should usually describe the user/project situation, not the agent CLI. The same fixture should be usable from pi, Claude Code, and future adapter tests when possible. Adapter-specific expectations can live under `expected/pi/`, `expected/claude/`, or be asserted directly by adapter-specific test cases.

## Existing profile-resolution fixtures

### `profile-precedence`

Location: `tests/fixtures/scenarios/profile-precedence/`

A compact fixture where user, project, and project-local profile sources all define the same `engineering` profile id.

Use it to verify same-id profile merge precedence and environment deep merge behavior. It is already used by current unit tests and does not need to move before integration tests are added.

### `profile-inheritance-chain`

Location: `tests/fixtures/scenarios/profile-inheritance-chain/`

A compact fixture where `engineering` inherits `base`, and the implicit `default` profile also inherits `base`.

Use it to verify explicit inheritance plus implicit user-default inclusion without duplicate base profiles.

### `profile-multiple-inheritance`

Location: `tests/fixtures/scenarios/profile-multiple-inheritance/`

A compact fixture where `composite` inherits both `first` and `second`, and all three profiles define overlapping environment values.

Use it to verify deterministic multiple-inheritance stack order and override behavior.

### `profile-cycle`

Location: `tests/fixtures/scenarios/profile-cycle/`

A compact negative fixture where profiles `a` and `b` inherit each other.

Use it to verify inheritance cycle diagnostics.

### `profile-missing-inheritance`

Location: `tests/fixtures/scenarios/profile-missing-inheritance/`

A compact negative fixture where `engineering` inherits a missing profile id.

Use it to verify missing inherited profile diagnostics.

## Integration fixtures

### `trivial_repo_only_profile`

Location: `tests/fixtures/integration/trivial_repo_only_profile/`

This is the ordinary happy path: the repository defines one checked-in profile, while the user has a normal `default` profile in `~/.bridl/profiles/default`.

The selected repo profile should compose with the user's implicit default profile. The fixture should intentionally omit profile-owned CLI state files so adapter defaults fall through to native standard locations, such as each adapter's normal config/state directory.

Use it as the first integration smoke test. It currently runs under pi and asserts the selected profile, launch plan, generated tack basics, and native fallback state ownership.

Write-back focus: generated tack files must not rewrite repo or user profile YAML. Durable CLI state should go only to adapter-declared native fallback paths.

### `heavily_overridden_engineering`

Location: `tests/fixtures/integration/heavily_overridden_engineering/`

This is the stress case for source precedence. The profile id `engineering` should exist in several places:

- a pre-seeded cached GitHub/team source;
- a repo-declared supplemental source;
- the user's profile source;
- the checked-in repo profile source;
- project-local overrides.

Each layer should use obvious values such as `REMOTE_ONLY`, `USER_ONLY`, `REPO_ONLY`, `LOCAL_ONLY`, and `SHARED` so failures identify the wrong winning layer immediately.

Use it to verify same-id profile precedence, source ordering, implicit defaults, inherited defaults, profile-folder attribution, and generated tack output when many sources contribute.

Write-back focus: if a highest-precedence profile-owned state file exists, writes through that declared state path should update only that source file. Mutating a generated file in the tack must not be ambiguously written back to any source layer.

### `remote_baseline_local_selection`

Location: `tests/fixtures/integration/remote_baseline_local_selection/`

This fixture should include pre-seeded cached remote settings and profile sources, plus local user/project settings. Project-local settings selects the active profile without editing checked-in project settings.

Use it to exercise remote settings composition while keeping tests offline and deterministic.

Write-back focus: expected output should make it obvious whether a value came from remote, user, project, or project-local input. Tack mutations should not blur that source ownership.

### `language_stack_with_personal_default`

Location: `tests/fixtures/integration/language_stack_with_personal_default/`

This fixture should model a real repo profile such as `typescript-review` that inherits repo language/tooling profiles. The user's implicit `default` profile contributes personal environment, prompt, or session defaults below the repo stack.

Use it to verify realistic inheritance plus implicit user-default composition.

Write-back focus: inherited generated controls should not be written back to any parent profile. If profile-owned CLI state is absent, adapter state should use native or cache fallback.

### `local_sandbox_overrides`

Location: `tests/fixtures/integration/local_sandbox_overrides/`

This fixture should have stable checked-in repo profiles, plus `.bridl/local/settings.yml` selecting a local-only sandbox profile. The sandbox can add experimental args, environment, prompts, and selected `state_persistence` overrides.

Use it to cover developer-local customization without changing repo files.

Write-back focus: writes to sandbox temporary paths should follow local `discard` or `warn` strategies and must not modify checked-in profiles.

### `strict_ci_profile`

Location: `tests/fixtures/integration/strict_ci_profile/`

This fixture should model a locked CI profile. It should use strict `state_persistence` values such as `unknown: error`, important settings/config paths as `error`, and caches/sessions as `discard`.

Use it to test reproducibility enforcement and post-run diagnostics for strict state persistence.

Write-back focus: the fake launcher should attempt both declared and unknown writes. Tests should assert failure or warnings without durable persistence for non-persistent paths.

### `profile_owned_cli_state`

Location: `tests/fixtures/integration/profile_owned_cli_state/`

This fixture should include a selected profile with generic controls plus adapter-specific state files under paths such as `cli_specific/pi/` and `cli_specific/claude/`.

Use it to let each adapter prove it selects its own profile-owned state without putting an adapter name in the fixture name.

Write-back focus: writes through declared symlinked state paths should update the selected profile-owned state for that adapter only.

### `native_fallback_cli_state`

Location: `tests/fixtures/integration/native_fallback_cli_state/`

This fixture should intentionally omit profile-owned CLI state files. The synthetic home/native directories can be empty or partially seeded.

Use it to verify the underlying adapter default behavior where declared state symlinks point at standard native CLI locations.

Write-back focus: writes persist only through declared native fallback symlinks. Missing fallback files or directories are created intentionally.

### `cache_backed_tooling_state`

Location: `tests/fixtures/integration/cache_backed_tooling_state/`

Status: implemented for pi reusable tooling paths.

This fixture configures an explicit `cache_directory`. Adapters with reusable helper, tooling, utility, or cache paths should use that cache rather than profile folders.

Use it to verify cache reuse across temporary tacks.

Write-back focus: cache-backed writes persist to the configured cache and should not appear in profile or native settings locations.

### `adapter_specific_overrides`

Location: `tests/fixtures/integration/adapter_specific_overrides/`

This fixture should have one selected profile with generic controls plus adapter-specific controls, such as `controls.pi` and `controls.claude`. It can also include adapter-specific `cli_specific/` files.

Use it to run the same profile under multiple adapters and verify that generic controls plus adapter-specific overrides translate correctly.

Write-back focus: adapter-specific state writes affect only that adapter's declared state paths. Generic generated tack content remains non-write-back unless explicitly persistent.

### `state_path_replaced_by_agent`

Location: `tests/fixtures/integration/state_path_replaced_by_agent/`

This fixture should start with one or more declared persistent state symlinks. The fake launcher replaces a symlink itself with a regular file or directory instead of writing through it.

Use it as regression coverage for accidental symlink replacement by child CLIs.

Write-back focus: replacement should be diagnosed as not persisted, and the original durable source should remain unchanged.

## Summary matrix

<<<<<<< HEAD:tests/fixtures/integration/INTEGRATION_TEST_FIXTURES.md
| Fixture | Status | Settings layers | Same-id defs | Inherit depth | Adapters | State owner | Mutation focus |
| -------------------------------------- | -------- | ------------------- | ------------ | ---------------- | -------------- | --------------- | ---------------- |
| `profile-precedence` | Existing | none | 3 | 0 | none | none | none |
| `profile-inheritance-chain` | Existing | none | 1 | 1 + default | none | none | none |
| `profile-multiple-inheritance` | Existing | none | 1 | 2 parents | none | none | none |
| `profile-cycle` | Existing | none | 1 | cycle | none | none | diagnostics |
| `profile-missing-inheritance` | Existing | none | 1 | missing | none | none | diagnostics |
| `trivial_repo_only_profile` | Existing | user + repo | 1 | implicit default | pi | native fallback | generated files |
| `heavily_overridden_engineering` | Existing | remote + 3 | 5 | 1-2 | all | highest profile | source ownership |
| `remote_baseline_local_selection` | Existing | remote + 3 | 1-2 | implicit default | all | mixed | source ownership |
| `language_stack_with_personal_default` | Existing | user + repo | 1 | 2-3 | all | native fallback | inherited output |
| `local_sandbox_overrides` | Existing | user + repo + local | 1-2 | 1 | all | temporary | local overrides |
| `strict_ci_profile` | Existing | repo | 1 | 0-1 | all | temporary | errors |
| `profile_owned_cli_state` | Proposed | user + repo | 1 | 0-1 | all | profile state | symlink writes |
| `native_fallback_cli_state` | Existing | user + repo | 1 | 0-1 | all | native fallback | fallback writes |
| `cache_backed_tooling_state` | Existing | user + repo | 1 | 0 | adapter subset | cache | cache writes |
| `adapter_specific_overrides` | Existing | user + repo | 1 | 0-1 | all | mixed | adapter controls |
| `state_path_replaced_by_agent` | Existing | user + repo | 1 | 0 | all | profile/native | symlink replaced |
=======
| Fixture | Status | Settings layers | Same-id defs | Inherit depth | Adapters | State owner | Mutation focus |
| -------------------------------------- | -------- | ------------------- | ------------ | ---------------- | --------- | --------------- | ---------------- |
| `profile-precedence` | Existing | none | 3 | 0 | none | none | none |
| `profile-inheritance-chain` | Existing | none | 1 | 1 + default | none | none | none |
| `profile-multiple-inheritance` | Existing | none | 1 | 2 parents | none | none | none |
| `profile-cycle` | Existing | none | 1 | cycle | none | none | diagnostics |
| `profile-missing-inheritance` | Existing | none | 1 | missing | none | none | diagnostics |
| `trivial_repo_only_profile` | Proposed | user + repo | 1 | implicit default | all | native fallback | generated files |
| `heavily_overridden_engineering` | Existing | remote + 3 | 5 | 1-2 | all | highest profile | source ownership |
| `remote_baseline_local_selection` | Proposed | remote + 3 | 1-2 | implicit default | all | mixed | source ownership |
| `language_stack_with_personal_default` | Proposed | user + repo | 1 | 2-3 | all | native fallback | inherited output |
| `local_sandbox_overrides` | Proposed | user + repo + local | 1-2 | 1 | all | temporary | local overrides |
| `strict_ci_profile` | Existing | repo | 1 | 0-1 | all | temporary | errors |
| `profile_owned_cli_state` | Proposed | user + repo | 1 | 0-1 | all | profile state | symlink writes |
| `native_fallback_cli_state` | Proposed | user + repo | 1 | 0-1 | all | native fallback | fallback writes |
| `cache_backed_tooling_state` | Added | user + repo | 1 | implicit default | pi subset | cache | cache writes |
| `adapter_specific_overrides` | Existing | user + repo | 1 | 0-1 | all | mixed | adapter controls |
| `state_path_replaced_by_agent` | Proposed | user + repo | 1 | 0 | all | profile/native | symlink replaced |

> > > > > > > 1ec01b1 (Add cache-backed tooling integration fixture):INTEGRATION_TEST_FIXTURES.md
