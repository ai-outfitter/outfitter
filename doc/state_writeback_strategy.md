# State Writeback Strategy

This document describes ApplePi's current model for handling writes that agent CLIs make inside a composite profile.

A composite profile is temporary, but agent CLIs sometimes perform intentionally durable writes, such as logging in, installing plugins, changing settings, or updating MCP configuration.
ApplePi makes those paths explicit: adapter-declared writable paths are materialized with a resolved `state_persistence` strategy before the child CLI starts, and non-persistent or unknown writes are diagnosed after the child exits.

## Functional model

ApplePi separates three kinds of files that may exist in a composite profile:

1. **Generated runtime files**: files ApplePi assembles from settings, profiles, templates, and adapter rules.
   ApplePi may regenerate these while the child agent is running when their source inputs change.
2. **Declared state paths**: adapter-known files or directories the agent CLI may update intentionally, such as auth, settings, MCP config, plugins, caches, and sessions.
3. **Unknown writes**: files or directories the agent creates outside the adapter-declared state paths.

Only declared state paths can be made durable automatically.
Unknown writes are never silently persisted because ApplePi does not know their intended owner, merge rules, or durable destination.
Generated runtime files and declared state paths are deliberately handled separately so live profile/template updates do not erase or re-baseline agent state changes made during the same run.

The user-facing state update lifecycle is:

1. **Choose a profile**.
   Profile resolution determines the effective `state_persistence` map using normal profile precedence.
2. **Resolve adapter defaults**.
   For each path the selected adapter declares, ApplePi uses the profile override when present and otherwise uses the adapter default.
3. **Prepare the composite profile**.
   Durable paths are connected to a profile-managed or native CLI location; non-durable paths are created as normal temporary composite profile paths.
4. **Run the agent**.
   The agent CLI reads and writes the composite profile as if it were its normal configuration directory.
5. **Classify changes after exit**.
   ApplePi checks non-durable declared paths and unknown paths and reports or fails according to their strategies.
6. **Clean up temporary state**.
   Temporary composite profile contents are discarded; durable symlink targets remain in their profile or native CLI location.

## Current behavior

- Composite profiles remain temporary and reproducible by default.
- ApplePi does not do generic post-run copy-back or JSON/YAML merge-back.
- Persistent state is represented by symlinking a composite profile path to a profile file/directory or to the native CLI fallback path.
- Adapters may generate a concrete runtime file for a declared state path when they need deterministic launch-time reconciliation. For example, the Pi adapter can generate a transformed `settings.json` that removes native `packages` entries already supplied by profile-controlled extensions, and then mark that declared path as `discard` for write detection during the run.
- Every adapter-declared state path has a resolved strategy before launch: profile overrides win, otherwise the adapter `default_strategy` is used, except for adapter-generated reconciliation files that are intentionally treated as discarded runtime files.
- Invalid or disallowed profile-requested `state_persistence` strategies fail before launch; adapter-internal reconciliation may still choose a one-run handling strategy for a generated runtime file.
- Non-persistent `warn` and `error` strategies are checked after the child CLI exits.
- Unknown writes outside adapter-declared paths are checked with the adapter's `unknown` pseudo-path strategy.
- `prompt` is reserved for a future interactive/control-plane workflow.
  When accepted by a declaration today, it is treated as a non-persistent diagnostic like `warn`.

## Non-goals

- ApplePi does not implement generic copy-back from the composite profile to profiles.
- ApplePi does not implement generic structured merge-back.
- ApplePi does not silently persist unknown writes.

## Profile stack and native fallback

State persistence is a normal profile setting.
Its strategy overrides resolve through the same profile stack as other profile data:

```text
project-local profile
project profile
user profile
URI/cache profiles
explicit inheritance
implicit user default profile
ApplePi default profile
```

Native CLI state is not represented as an extra profile layer.
For `symlink` paths without a profile-provided source, the selected adapter resolves a native fallback location directly, such as `~/.pi/agent/...` for most Pi state paths, `~/.claude/...` for most Claude Code state paths, or `<cache_directory>/utilities` for Pi `utilities/` and `bin/`.
This native fallback is not a base profile: it does not participate in profile inheritance or merge precedence, and it cannot contribute controls or profile YAML.
Claude Code `projects/` is additionally controlled by `controls.session_directory` or `controls.claude.session_directory` when set.

## Path-keyed adapter declarations

Adapters declare writable state paths directly, using relative file paths as keys.
Directory paths use a trailing slash.
The same key is used for adapter coverage, `state_persistence` overrides, profile resource lookup, native fallback lookup, and composite profile materialization.

The Pi adapter currently declares:

```yaml
state_paths:
  auth.json:
    default_strategy: symlink
    allowed_strategies: [symlink, error, prompt]

  settings.json:
    default_strategy: symlink
    allowed_strategies: [symlink, warn, error, prompt]
    note: >-
      When profile-controlled Pi extensions duplicate native settings packages,
      ApplePi may generate a transformed runtime settings.json and treat this
      declared path as discard for that launch. That discard handling is
      adapter-internal; users still cannot request settings.json: discard
      because discard is not listed in allowed_strategies.

  mcp.json:
    default_strategy: symlink
    allowed_strategies: [symlink, warn, error, prompt]

  plugins/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error, prompt]

  cache/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  sessions/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  npm/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  git/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  tmp/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard]

  utilities/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  bin/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  unknown:
    default_strategy: warn
    allowed_strategies: [discard, warn, error, prompt]
```

The Claude Code adapter currently declares:

```yaml
state_paths:
  settings.json:
    default_strategy: symlink
    allowed_strategies: [symlink, warn, error, prompt]

  agents/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error, prompt]

  skills/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error, prompt]

  commands/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error, prompt]

  plugins/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error, prompt]

  projects/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  debug/:
    default_strategy: symlink
    allowed_strategies: [symlink, discard, warn, error]

  unknown:
    default_strategy: warn
    allowed_strategies: [discard, warn, error, prompt]
```

## Profile layout for state files

State files live under the relevant CLI-specific profile folder:

```text
profiles/
  default/
    profile.yml
    cli_specific/
      pi/
        auth.json
        settings.json
        plugins/
      claude/
        settings.json
        skills/
        commands/
        plugins/
```

Except for special adapter paths described below, when a selected strategy is `symlink`, ApplePi searches the resolved profile folders from highest to lowest precedence for `cli_specific/<adapter>/<state-path>`.
If a profile contains the file or directory, ApplePi symlinks the composite profile path to that source.

For most Pi paths, if no profile source exists, ApplePi falls back to the corresponding native Pi agent path under `~/.pi/agent`.
Missing native fallback files/directories are created so the composite profile symlink has a durable destination.

Pi `utilities/` and `bin/` are special cache-backed paths: both resolve to `<cache_directory>/utilities` instead of profile or native Pi state.
This keeps pi-managed helper binaries reusable across temporary composite profiles without treating them as user-editable profile files.

For most Claude Code paths, if no profile source exists, ApplePi falls back to the corresponding native Claude Code path under `~/.claude`.
Claude Code `projects/` is special: `controls.claude.session_directory` overrides generic `controls.session_directory`, and the selected session directory becomes the `projects/` symlink source.
If neither session-directory control is present, `projects/` falls back to `~/.claude/projects`.

## `state_persistence`

Profiles may override persistence by mapping adapter-declared paths to strategy names:

```yaml
state_persistence:
  auth.json: symlink
  settings.json: symlink
  plugins/: symlink
  cache/: discard
  sessions/: discard
  unknown: warn
```

The values are concrete strategy names.
`state_persistence` only needs overrides; omitted paths use the adapter declaration's `default_strategy`.

`state_persistence` is validated by the profile JSON Schema at read boundaries.
ApplePi also validates the resolved strategy against the adapter declaration before launch.

Functional examples:

```yaml
# Persist logins and settings, but make caches and sessions run-local.
state_persistence:
  auth.json: symlink
  settings.json: symlink
  cache/: discard
  sessions/: discard
```

```yaml
# CI profile: fail if pi changes settings, MCP config, or unknown files.
state_persistence:
  settings.json: error
  mcp.json: error
  plugins/: error
  unknown: error
```

```yaml
# Exploratory profile: allow plugin experiments but report them after exit.
state_persistence:
  plugins/: warn
  unknown: warn
```

## Composite profile materialization

Before launch, ApplePi processes each adapter-declared state path:

1. Resolve the path's strategy from profile `state_persistence` overrides, then the adapter `default_strategy`.
2. Validate that the strategy is allowed for that path.
3. Resolve a source path through the profile hierarchy when the strategy is `symlink`.
4. Materialize the composite profile path.
5. Record a baseline fingerprint for non-persistent and unknown write detection.

For `symlink`, ApplePi creates a symlink from the composite profile path to the resolved profile or native CLI source.

For `discard`, `warn`, `error`, and `prompt`, ApplePi creates normal temporary composite profile paths where needed and observes whether they changed.

## Unknown writes

The `unknown` pseudo-path controls writes outside adapter-declared paths:

```yaml
state_persistence:
  unknown: warn
```

Supported `unknown` strategies are non-persistent only:

- `discard`
- `warn`
- `error`
- `prompt`

`unknown` does not support `symlink`, because there is no declared durable destination.

## Strategy selection guide

Use `symlink` when a write is part of durable agent setup, such as logging in, editing native settings, updating MCP config, or installing plugins that should be reused.
Use `discard` when the data is useful only during the current run, such as cache entries or throwaway sessions.
Use `warn` when mutation is acceptable but should be visible to the user.
Use `error` when mutation means the run was not reproducible enough, especially in CI or locked-down project profiles.
Use `prompt` only as a forward-compatible declaration for future interactive handling.

## Strategies

### `symlink`

ApplePi resolves the state path through the profile hierarchy, then the native CLI fallback, and symlinks that source into the composite profile.
Persistence happens because the CLI writes through the symlink to an intentional file or directory.

### `discard`

Writes are allowed in the composite profile and are thrown away when the composite profile is deleted.
ApplePi does not emit diagnostics for changed `discard` paths.

### `warn`

Writes are allowed, discarded, and reported after the child exits.
`--strict` makes these warnings fatal.

### `error`

Writes are allowed during the child process but cause ApplePi to fail after the child exits if the path changed.
This is useful for CI and strict reproducibility.

### `prompt`

`prompt` is reserved for a future interactive/control-plane workflow.
Current implementations that allow it treat writes as non-persistent diagnostics, equivalent to `warn`, with the strategy name preserved in the message.

## Rationale

Path-keyed state declarations keep the model simple:

- the adapter declares the paths it knows the CLI may write and their default strategies;
- profiles may provide files at those same paths;
- the native fallback exposes native CLI files at those same paths;
- `state_persistence` says what to do with each path.

This avoids ambiguous writeback behavior and gives users a clear rule: if a CLI write should persist, configure that composite profile path as `symlink` and provide or accept the profile/native file that should receive the mutation.
