# strict_ci_profile

This fixture models a locked CI job that must fail rather than silently keep agent CLI state outside declared reproducible inputs.

## Setup

- `home/` is a minimal synthetic CI user home with Bridl configured for the pi adapter and a disposable cache directory.
- `project/` is the repository checkout. Its `.bridl/settings.yml` selects the checked-in `ci-strict` profile and uses only repository profile sources.
- `project/.bridl/profiles/ci-strict/profile.yml` defines deterministic launch controls and strict state persistence:
  - `settings.json` and `mcp.json` are `error` so writes to important configuration are diagnosed after the agent exits.
  - `cache/` and `sessions/` are `discard` so transient runtime data is ignored and does not persist durably.
  - `unknown` is `error` so any undeclared tack write fails the run.

## Write-back behavior under test

The Vitest integration tests copy this fixture to a temporary directory, run the pi adapter through `tests/integration/fixtureHarness.ts`, and use fake launchers that mutate the tack.

Expected behavior:

- Writes to `settings.json` or `mcp.json` fail with a post-run diagnostic and do not update `home/.pi/agent/`.
- Writes under discarded cache/session directories do not produce diagnostics and do not persist to native or profile-owned state.
- Writes to undeclared paths fail with an unknown-state diagnostic.
- Generated Bridl tack files may be mutated by the fake launcher, but fixture YAML remains unchanged because generated files are not written back to profile sources.
