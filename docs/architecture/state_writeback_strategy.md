# State Writeback Strategy

This document describes Outfitter's model for handling writes that agent CLIs make inside a temporary projection — the generated configuration directory an adapter builds from a baked composition.

A projection is temporary, but agent CLIs sometimes perform intentionally durable writes, such as logging in, installing plugins, changing settings, or updating MCP configuration. Outfitter makes those paths explicit: adapter-declared writable paths are materialized with a resolved `state_persistence` strategy before the child CLI starts, and non-persistent or unknown writes are diagnosed after the child exits.

## Functional model

Outfitter separates three kinds of files that may exist in a projection:

1. **Generated runtime files**: files Outfitter assembles from the baked composition and adapter rules.
2. **Declared state paths**: adapter-known files or directories the agent CLI may update intentionally, such as auth, settings, MCP config, plugins, caches, and sessions.
3. **Unknown writes**: files or directories the agent creates outside the adapter-declared state paths.

Only declared state paths can be made durable automatically. Unknown writes are never silently persisted because Outfitter does not know their intended owner, merge rules, or durable destination. Generated runtime files and declared state paths are deliberately handled separately so composition regeneration does not erase or re-baseline agent state changes made during the same run.

The user-facing state update lifecycle is:

1. **Resolve settings.** Settings resolution determines the effective `state_persistence` map using normal settings precedence (`settings.local.yml` over `settings.yml`, project over user).
2. **Resolve adapter defaults.** For each path the selected adapter declares, Outfitter uses the settings override when present and otherwise uses the adapter default.
3. **Prepare the projection.** Durable paths are connected to a native CLI location; non-durable paths are created as normal temporary projection paths.
4. **Run the agent.** The agent CLI reads and writes the projection as if it were its normal configuration directory.
5. **Classify changes after exit.** Outfitter checks non-durable declared paths and unknown paths and reports, prompts, or fails according to their strategies.
6. **Clean up temporary state.** Temporary projection contents are discarded; durable symlink targets remain in their native CLI location.

## Current behavior

- Projections remain temporary and reproducible by default.
- Outfitter does not do generic post-run copy-back or JSON/YAML merge-back.
- Persistent state is represented by symlinking a projection path to the native CLI fallback path.
- Adapters may generate a concrete runtime file for a declared state path when they need deterministic launch-time reconciliation. For example, the Pi adapter can generate a transformed `settings.json` that removes native `packages` entries already supplied by composition-controlled extensions, and then mark that declared path as `discard` for write detection during the run.
- Every adapter-declared state path has a resolved strategy before launch: settings overrides win, otherwise the adapter `default_strategy` is used, except for adapter-generated reconciliation files that are intentionally treated as discarded runtime files.
- Invalid or disallowed requested `state_persistence` strategies fail before launch; adapter-internal reconciliation may still choose a one-run handling strategy for a generated runtime file.
- Non-persistent `warn` and `error` strategies are checked after the child CLI exits.
- Unknown writes outside adapter-declared paths are checked with the adapter's `unknown` pseudo-path strategy.
- Baked artifacts and dumps never include declared state paths or their contents; state is runtime, not configuration.

## Non-goals

- Outfitter does not implement generic copy-back from the projection to `.agents` trees.
- Outfitter does not implement generic structured merge-back.
- Outfitter does not silently persist unknown writes.

## Settings resolution and native fallback

State persistence is a normal Outfitter setting. Its strategy overrides resolve through the same settings precedence as other settings data:

```text
<project>/.agents/settings.local.yml
<project>/.agents/settings.yml
~/.agents/settings.local.yml
~/.agents/settings.yml
cached remote settings
Outfitter defaults
```

Native CLI state is not a configuration layer. For `symlink` paths, the selected adapter resolves a native fallback location directly, such as `~/.pi/agent/...` for most Pi state paths, `~/.claude/...` for most Claude Code state paths, or `<cache_directory>/utilities` for Pi `utilities/` and `bin/`. The native fallback does not participate in resource resolution or merge precedence and cannot contribute resources. Claude Code `projects/` is additionally controlled by the session-directory setting when set.

For a [ported Claude Code setup](../documentation/porting-claude.md), configuration entries under `~/.claude` are symlinks into `~/.agents/`, so a durable write through the projection's `skills/` link lands in the protocol tree. The porting arrangement is created by setup; the state machinery just follows the links.

## Path-keyed adapter declarations

Adapters declare writable state paths directly, using relative file paths as keys. Directory paths use a trailing slash. The same key is used for adapter coverage, `state_persistence` overrides, native fallback lookup, and projection materialization.

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
      When composition-controlled Pi extensions duplicate native settings
      packages, Outfitter may generate a transformed runtime settings.json and
      treat this declared path as discard for that launch. That discard
      handling is adapter-internal; users still cannot request
      settings.json: discard because discard is not listed in
      allowed_strategies.

  keybindings.json:
    default_strategy: symlink
    allowed_strategies: [symlink, warn, error, prompt]
    note: >-
      Outfitter generates a transformed runtime keybindings.json so Shift+Tab
      can switch Outfitter modes and Ctrl+Shift+T can cycle Pi thinking levels.
      The generated runtime file is treated as discard for that launch.

  mcp.json:
    default_strategy: symlink
    allowed_strategies: [symlink, warn, error, prompt]

  models.json:
    default_strategy: symlink
    allowed_strategies: [symlink, warn, error, prompt]

  trust.json:
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

## `state_persistence`

Settings may override persistence by mapping adapter-declared paths to strategy names:

```yaml
state_persistence:
  auth.json: symlink
  settings.json: symlink
  plugins/: symlink
  cache/: discard
  sessions/: discard
  unknown: warn
```

The values are concrete strategy names. `state_persistence` only needs overrides; omitted paths use the adapter declaration's `default_strategy`.

`state_persistence` is validated by the settings JSON Schema at read boundaries. Outfitter also validates the resolved strategy against the adapter declaration before launch.

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
# CI settings: fail if pi changes settings, MCP config, or unknown files.
state_persistence:
  settings.json: error
  mcp.json: error
  plugins/: error
  unknown: error
```

```yaml
# Exploratory settings: allow plugin experiments but report them after exit.
state_persistence:
  plugins/: warn
  unknown: warn
```

## Projection materialization

Before launch, Outfitter processes each adapter-declared state path:

1. Resolve the path's strategy from `state_persistence` overrides, then the adapter `default_strategy`.
2. Validate that the strategy is allowed for that path.
3. Resolve the native fallback source when the strategy is `symlink`; missing native fallback files/directories are created so the symlink has a durable destination.
4. Materialize the projection path.
5. Record a baseline fingerprint for non-persistent and unknown write detection.

For `symlink`, Outfitter creates a symlink from the projection path to the resolved native CLI source. For `discard`, `warn`, `error`, and `prompt`, Outfitter creates normal temporary projection paths where needed and observes whether they changed.

Pi `utilities/` and `bin/` are special cache-backed paths: both resolve to `<cache_directory>/utilities` instead of native Pi state, keeping pi-managed helper binaries reusable across temporary projections. Claude Code `projects/` uses the configured session directory when set, otherwise `~/.claude/projects`.

## Unknown writes

The `unknown` pseudo-path controls writes outside adapter-declared paths:

```yaml
state_persistence:
  unknown: warn
```

Supported `unknown` strategies are non-persistent only: `discard`, `warn`, `error`, and `prompt`. `unknown` does not support `symlink`, because there is no declared durable destination; `unknown: prompt` reports as a warning with an explanation.

## Strategy selection guide

Use `symlink` when a write is part of durable agent setup, such as logging in, editing native settings, updating MCP config, or installing plugins that should be reused. Use `discard` when the data is useful only during the current run, such as cache entries or throwaway sessions. Use `warn` when mutation is acceptable but should be visible to the user. Use `error` when mutation means the run was not reproducible enough, especially in CI or locked-down projects. Use `prompt` when the user should decide interactively after each run.

## Strategies

### `symlink`

Outfitter resolves the state path to its native CLI fallback and symlinks that source into the projection. Persistence happens because the CLI writes through the symlink to an intentional file or directory.

### `discard`

Writes are allowed in the projection and are thrown away when the projection is deleted. Outfitter does not emit diagnostics for changed `discard` paths.

### `warn`

Writes are allowed, discarded, and reported after the child exits. `--strict` makes these warnings fatal.

### `error`

Writes are allowed during the child process but cause Outfitter to fail after the child exits if the path changed. This is useful for CI and strict reproducibility.

### `prompt`

When a `prompt` path changed and both stdin and stdout are interactive terminals, Outfitter asks after the child exits: **persist** (copy the change to the durable destination once), **discard**, or **always** (persist and record a `symlink` override in the editable settings scope). Outfitter never mutates a synced catalog cache; when the active configuration is remote, the change is persisted once with a warning that the choice could not be recorded. In non-interactive sessions, `prompt` falls back to `warn` with an explicit `prompt skipped: non-interactive` notice.

## Rationale

Path-keyed state declarations keep the model simple:

- the adapter declares the paths it knows the CLI may write and their default strategies;
- the native fallback exposes native CLI files at those same paths;
- `state_persistence` says what to do with each path.

This avoids ambiguous writeback behavior and gives users a clear rule: if a CLI write should persist, configure that projection path as `symlink` and accept the native file that should receive the mutation. Configuration flows the other direction — from the `.agents` tree into the projection — and never back.
