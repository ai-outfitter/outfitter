# State Writeback Strategy

This document describes Bridl's current model for handling writes that agent CLIs make inside a tack.

A tack is temporary, but agent CLIs sometimes perform intentionally durable writes, such as logging in, installing plugins, changing settings, or updating MCP configuration. Bridl makes those paths explicit: adapter-declared writable paths are materialized with a resolved `state_persistence` strategy before the child CLI starts, and non-persistent or unknown writes are diagnosed after the child exits.

## Current behavior

- Tacks remain temporary and reproducible by default.
- Bridl does not do generic post-run copy-back or JSON/YAML merge-back.
- Persistent state is represented by symlinking a tack path to a profile file/directory or to the native CLI fallback path.
- Every adapter-declared state path has a resolved strategy before launch: profile overrides win, otherwise the adapter `default_strategy` is used.
- Invalid or disallowed strategies fail before launch.
- Non-persistent `warn` and `error` strategies are checked after the child CLI exits.
- Unknown writes outside adapter-declared paths are checked with the adapter's `unknown` pseudo-path strategy.
- `prompt` is reserved for a future interactive/control-plane workflow. When accepted by a declaration today, it is treated as a non-persistent diagnostic like `warn`.

## Non-goals

- Bridl does not implement generic copy-back from the tack to profiles.
- Bridl does not implement generic structured merge-back.
- Bridl does not silently persist unknown writes.

## Profile stack

State persistence is a normal profile setting. It resolves through the same profile stack as other profile data, with one adapter-provided native fallback layer for symlink sources:

```text
project-local profile
project profile
user profile
URI/cache profiles
explicit inheritance
implicit user default profile
Bridl default profile
native-cli-settings-profile
```

The `native-cli-settings-profile` is synthesized by the adapter as a fallback source for native CLI files, such as `~/.pi/...`. It is not a user-editable Bridl profile.

## Path-keyed adapter declarations

Adapters declare writable state paths directly, using relative file paths as keys. Directory paths use a trailing slash. The same key is used for adapter coverage, `state_persistence` overrides, profile resource lookup, native fallback lookup, and tack materialization.

The Pi adapter currently declares:

```yaml
state_paths:
  auth.json:
    default_strategy: symlink
    allowed_strategies: [symlink, error, prompt]

  settings.json:
    default_strategy: symlink
    allowed_strategies: [symlink, warn, error, prompt]

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
```

When a selected strategy is `symlink`, Bridl searches the resolved profile folders from highest to lowest precedence for `cli_specific/<adapter>/<state-path>`. If a profile contains the file or directory, Bridl symlinks the tack path to that source.

If no profile source exists for a Pi path, Bridl falls back to the corresponding native Pi agent path under `~/.pi/agent`. Missing native fallback files/directories are created so the tack symlink has a durable destination.

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

The values are concrete strategy names. `state_persistence` only needs overrides; omitted paths use the adapter declaration's `default_strategy`.

`state_persistence` is validated by the profile JSON Schema at read boundaries. Bridl also validates the resolved strategy against the adapter declaration before launch.

## Tack materialization

Before launch, Bridl processes each adapter-declared state path:

1. Resolve the path's strategy from profile `state_persistence` overrides, then the adapter `default_strategy`.
2. Validate that the strategy is allowed for that path.
3. Resolve a source path through the profile hierarchy when the strategy is `symlink`.
4. Materialize the tack path.
5. Record a baseline fingerprint for non-persistent and unknown write detection.

For `symlink`, Bridl creates a symlink from the tack path to the resolved profile or native CLI source.

For `discard`, `warn`, `error`, and `prompt`, Bridl creates normal temporary tack paths where needed and observes whether they changed.

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

## Strategies

### `symlink`

Bridl resolves the state path through the profile hierarchy, then the native CLI fallback, and symlinks that source into the tack. Persistence happens because the CLI writes through the symlink to an intentional file or directory.

### `discard`

Writes are allowed in the tack and are thrown away when the tack is deleted. Bridl does not emit diagnostics for changed `discard` paths.

### `warn`

Writes are allowed, discarded, and reported after the child exits. `--hard-tack` makes these warnings fatal.

### `error`

Writes are allowed during the child process but cause Bridl to fail after the child exits if the path changed. This is useful for CI and strict reproducibility.

### `prompt`

`prompt` is reserved for a future interactive/control-plane workflow. Current implementations that allow it treat writes as non-persistent diagnostics, equivalent to `warn`, with the strategy name preserved in the message.

## Rationale

Path-keyed state declarations keep the model simple:

- the adapter declares the paths it knows the CLI may write and their default strategies;
- profiles may provide files at those same paths;
- the native fallback exposes native CLI files at those same paths;
- `state_persistence` says what to do with each path.

This avoids ambiguous writeback behavior and gives users a clear rule: if a CLI write should persist, configure that tack path as `symlink` and provide or accept the profile/native file that should receive the mutation.
