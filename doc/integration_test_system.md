# Integration Test System

## Purpose

Outfitter uses fixture-backed integration tests to exercise real settings/profile directory trees rather than constructing every input inside individual tests.
This is especially important for composite profile generation and state persistence because the effective runtime composite profile can be composed from multiple settings files, multiple profile sources, inherited profiles, adapter defaults, and CLI-specific profile state files.

The core risk is that a generated composite profile can look correct in isolated unit tests while write-back/state-persistence behavior remains ambiguous or unsafe when the composite profile came from four or more durable sources.
Integration fixtures make those source relationships visible and testable.

## Goals

- Store realistic, pre-written Outfitter projects as fixture directories.
- Copy each fixture into a temporary directory before the test mutates it.
- Traverse fixtures through the same public loading, resolution, composite profile assembly, and run/write detection paths used by commands.
- Assert the resulting composite profile shape, symlinks, generated files, argv/env launch plan, warnings, and durable write results.
- Make source ownership explicit enough that tests prove Outfitter does not perform unsupported generic write-back into composed settings/profile inputs.
- Keep fixtures reusable across tests and documented in the integration fixture catalog.

## Non-goals

- Integration tests do not replace focused unit tests for schema validation, merge algorithms, adapter helpers, or path-safety checks.
- Outfitter does not implement generic structured merge-back from generated composite profile files into settings or profiles.
- Integration tests do not require real pi or Claude Code binaries.
  Tests inject fake launchers that read/write the composite profile.
- Integration tests do not depend on the developer machine's real home directory, native CLI config, or network state.

## Repository layout

```text
tests/
  integration/
    composite profile-generation.test.ts
    fixtureHarness.ts
  fixtures/
    integration/
      README.md
      trivial_repo_only_profile/
        README.md
        home/
          .outfitter/settings.yml
          .outfitter/profiles/default/profile.yml
        project/
          .outfitter/settings.yml
          .outfitter/profiles/repo-review/profile.yml
        expected/
          pi/
            composite profile-summary.json
            warnings.json
```

The existing `tests/fixtures/scenarios/` directory contains small profile-resolution fixtures used by current unit tests.
The integration framework does not replace or move those fixtures.
End-to-end fixtures live in `tests/fixtures/integration/` because they model full home/project/cache/native trees and expected composite profile effects.
When an existing scenario is useful for an integration test, copy or expand it into a new integration fixture instead of changing the existing unit-test fixture in place.

Additional fixture-set PRs target this framework branch and add more directories under `tests/fixtures/integration/`.

## Fixture directory contract

Each integration fixture is a complete synthetic filesystem tree.
A fixture uses these top-level entries:

| Path        | Purpose                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------ |
| `README.md` | Human explanation of the scenario and the behavior it protects.                                              |
| `home/`     | Synthetic user home directory passed to command execution.                                                   |
| `project/`  | Synthetic project directory passed to command execution.                                                     |
| `expected/` | Expected composite profile summaries, symlink targets, warnings, launch args/env, and durable file contents. |

A fixture may also include these top-level entries:

| Path      | Purpose                                                                                         |
| --------- | ----------------------------------------------------------------------------------------------- |
| `native/` | Explicit native CLI state tree for tests that map adapter fallbacks away from `home/`.          |
| `cache/`  | Pre-seeded Outfitter cache, remote-profile cache, or adapter cache/tooling state when required. |

Settings and profiles inside `home/` and `project/` use normal Outfitter paths such as `.outfitter/settings.yml`, `.outfitter/local/settings.yml`, and `.outfitter/profiles/<id>/profile.yml`.
CLI-specific state lives under profile folders, for example `cli_specific/pi/settings.json` or `cli_specific/claude/settings.json`.
Fixture names describe the user/project scenario rather than the adapter; adapter-specific expected output is nested under `expected/pi/`, `expected/claude/`, and similar directories.

## Harness responsibilities

`tests/integration/fixtureHarness.ts` exports these helpers:

- `copyFixtureToTemp(name)` copies `tests/fixtures/integration/<name>` into `mkdtemp` and returns an `IntegrationFixture` with `root`, `home`, `project`, `cache`, and `expected` paths.
- `runFixture(fixture, options)` executes `executeRunCommand` with the copied home/project and the provided fake launcher.
- `summarizePiComposite profile(fixture, composite profileRoot)` returns stable pi-specific facts about generated profile content and selected state symlinks.
- `readExpectedJson(fixture, relativePath)` loads expected fixture output from the copied `expected/` tree.
- `readFixtureText(fixture, relativePath)` reads a text file from the copied fixture root.
- `cleanupIntegrationFixtures()` removes copied fixtures after each test.

The harness normalizes absolute paths in expected output using tokens such as `<fixture>`, `<home>`, `<project>`, `<cache>`, and `<composite profile>`.
This keeps expected files readable and independent of temporary directory names.

## Where mutations and assertions live

The framework uses a split model:

- **Fixture files encode inputs and expected stable outputs.
  ** The fixture directory contains settings, profiles, CLI-specific state files, and optional `expected/*.json` snapshots such as expected symlink targets, warnings, or final durable file contents.
- **Test code encodes behavior.
  ** The Vitest test case chooses which fixture to run, defines the fake launcher's mutation script, and performs assertions against the copied fixture and any expected files.

This keeps fixtures readable as normal Outfitter directory trees while keeping active behavior in TypeScript where it can use filesystem APIs, helper functions, and precise assertions.
Do not hide executable test behavior in ad hoc YAML unless a future mutation-script format is deliberately added.

For example:

```ts
it('does not copy generated composed settings back to source layers', async () => {
  const fixture = copyFixtureToTemp('heavily_overridden_engineering');

  const result = await runFixture(fixture, {
    launcher(plan) {
      const composite profileRoot = composite profileRootFromLaunchPlan(plan);
      writeFileSync(join(composite profileRoot, 'outfitter', 'profile.json'), '{"mutated":true}\n');
      writeFileSync(join(composite profileRoot, 'unexpected.txt'), 'unknown write\n');
      return Promise.resolve(0);
    },
  });

  expect(result.warnings).toEqual(readExpectedJson(fixture, 'warnings.json'));
  expect(readFileSync(join(fixture.project, '.outfitter/settings.yml'), 'utf8')).toBe(
    readExpectedText(fixture, 'source-project-settings-after.yml'),
  );
});
```

A fixture can include optional expectation files like:

```text
expected/
  composite profile-summary.json
  warnings.json
  durable-files-after.json
  source-project-settings-after.yml
```

The test decides how much to snapshot.
Use structured expected files for broad composite profile summaries and explicit inline assertions for the key write-back invariant the test protects.

## Test flow

A typical integration test:

1. Copies a named fixture to a temporary directory.
2. Runs Outfitter command code with the copied `homeDirectory` and `projectDirectory`.
3. Uses a fake launcher defined in the Vitest test to inspect the composite profile while it exists.
4. Mutates declared or undeclared composite profile paths from that fake launcher when the scenario requires it.
5. Lets normal post-run state detection classify the mutations.
6. Asserts warnings/errors and durable source files after the command completes, using fixture `expected/` files where snapshots improve readability.

Example fake-launcher responsibilities:

```text
- Read the adapter config root from launch plan env, such as `PI_CODING_AGENT_DIR` or `CLAUDE_CONFIG_DIR`.
- Assert generated composite profile files exist.
- Assert declared persistent paths are symlinks to the expected profile/native/cache sources.
- Write to declared state paths and unknown files according to the scenario.
- Return exit code 0 unless the scenario is testing child failure handling.
```

## Composite profile assertions

Integration tests assert stable behavior, not incidental implementation details.
Useful composite profile assertions include:

- selected adapter and profile id;
- resolved profile stack order;
- generated Outfitter metadata files;
- generated adapter-specific files such as profile/settings payloads;
- launch argv and environment;
- symlink versus temporary materialization for each declared state path;
- symlink target precedence: project-local profile, project profile, user profile, cache, then native fallback as applicable;
- non-persistent baseline paths and detected writes;
- warnings becoming fatal under `--strict`.

## Write-back/state-persistence focus

The integration suite encodes the product rule from `doc/state_writeback_strategy.md`: Outfitter does not do generic post-run copy-back or structured merge-back.
Durable writes happen only through declared state paths that have a persistent strategy, normally by symlink.

Important cases:

- A generated composite profile file composed from several settings/profile layers is mutated in the composite profile.
  Current behavior is explicit: the mutation is not generically copied back to any source layer unless that path is an adapter-declared symlink.
- A state file supplied by a high-precedence profile is symlinked and receives writes directly.
- A declared state path configured as `warn` or `error` is not persisted.
- Unknown files written into the composite profile are classified by the adapter's `unknown` strategy and never silently persisted.
- Cache-backed adapter paths, such as Pi `utilities/` and `bin/`, persist to the configured cache rather than to profile directories.

## Fixture authoring rules

- Prefer realistic fixtures with one clear user/project story.
- Name fixtures after that story, such as `trivial_repo_only_profile` or `heavily_overridden_engineering`, rather than after an adapter.
- Include enough settings/profile layers to demonstrate precedence when the scenario is about merging.
- Use obvious values such as `REMOTE_ONLY`, `USER_ONLY`, `REPO_ONLY`, `LOCAL_ONLY`, and `SHARED` so failed assertions identify the wrong layer immediately.
- Keep expected output as JSON when possible so tests can diff structured facts.
- Avoid timestamps, random IDs, host-specific paths, and real credentials.
- Include a fixture-root `README.md` for every fixture set.

## Extension path

The framework currently includes `trivial_repo_only_profile` as the first implemented fixture.
Additional fixture-set PRs add the remaining cataloged scenarios under `tests/fixtures/integration/` and extend `tests/integration/composite profile-generation.test.ts` or add focused integration test files when needed.

When adding or changing a fixture:

1. Add or update the fixture root `README.md` in the same change.
2. Add static fixture files under `home/`, `project/`, optional `cache/` or `native/`, and optional `expected/`.
3. Add a Vitest integration test that copies the fixture, runs through command code, and asserts the composite profile/write-back behavior.
4. Update `tests/fixtures/integration/INTEGRATION_TEST_FIXTURES.md` when the fixture's scenario, status, or purpose changes.
5. Run `npm run check-ci` before opening or updating the PR.
