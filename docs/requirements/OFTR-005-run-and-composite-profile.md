# OFTR-005: Run Command and Composite profile Lifecycle

> **Transition (RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165)):** this requirement is being amended across the implementation stack. **OFTR-005.2 and OFTR-005.3 are amended (2026-07-17)** to the harness-neutral composition model below. The remaining sections (run command surface, watching, state persistence, prompt export) still describe pre-dotagents behavior and are amended together with their pinned tests in the adapter/run PR. Target design: [docs/architecture/README.md](../architecture/README.md).

## Overview

The `run` command assembles a temporary agent-specific configuration directory called a composite profile, launches the selected agent CLI, and keeps Outfitter alive to manage the composite profile while the child process runs.

## Requirements

### OFTR-005.1: Run Command Defaults

1. Outfitter MUST provide a `run` command.
2. `run` MUST be the default command when no command is specified.
3. The default command behavior MUST be implemented with Commander rather than a custom `process.argv` parser.
4. The `run` command MUST accept `-p` and `--profile` options for selecting the profile.
5. The `run` command MUST use the resolved default profile when no profile option is provided.
6. The `run` command MUST pass unrecognized arguments through to the selected agent CLI unaltered.
7. When invoked before user setup has created `~/.outfitter/settings.yml`, the default `run` command MUST execute setup before resolving the profile without printing a separate pre-setup announcement.

### OFTR-005.2: Composition Definition

_Amended (2026-07-17, RFC #165): a run is defined by a harness-neutral composition, not a profile._

1. Outfitter MUST compose a harness-neutral **composition plan** for a run from the effective resource set and a selected agent.
2. A composition plan MUST be scoped to one selected agent slug and is projected per harness by an adapter.
3. A composition plan MUST carry the composed identity (base `system-prompt.md`, shared `agents.md` context, and the agent's `agent.md` body) and the agent's resolved loadout.
4. Composition MUST be deterministic: identical sources, refs, and selections produce an identical composition plan.

### OFTR-005.3: Composition Assembly

_Amended (2026-07-17, RFC #165): composition assembles from the effective resource set._

1. Outfitter MUST compose identity by layering the winning `system-prompt.md` as the base, the winning `agents.md` as shared context, and the selected agent's body on top, in that deterministic order.
2. Outfitter MUST resolve each loadout slug (`skills`, `subagents`) against the effective resource set to its winning resource.
3. Outfitter MUST report an error when the selected agent slug does not resolve or its definition is invalid.
4. Outfitter MUST surface a loadout slug that does not resolve as a non-fatal composition warning.
5. `list`, `validate`, `run`, and `dump` MUST compose from the same shared resolver and composer.

### OFTR-005.4: Composite profile Watching

1. Outfitter MUST keep its process alive while the child agent CLI is running.
2. Outfitter MUST use `fs.watch` or an equivalent Node file watching mechanism on composite profile input files while the child process is running.
3. Outfitter MUST update generated composite profile files when watched inputs change and the generated output path remains inside the composite profile root.
4. Outfitter MUST warn when a live update cannot be applied because regeneration or composite profile-root path validation fails.

### OFTR-005.5: Unsupported Controls and Strict Mode

1. Outfitter MUST write a warning to stderr when a profile requests a control that the selected agent adapter cannot support.
2. The `run` command MUST accept a `--strict` option.
3. When `--strict` is enabled, unsupported controls MUST cause composite profile assembly to fail instead of only warning.
4. Strict failures MUST identify the unsupported control and selected agent CLI.

### OFTR-005.6: Composite profile State Persistence

1. Profiles MAY define `state_persistence` entries that map adapter-declared state paths to persistence strategies.
2. Outfitter MUST validate `state_persistence` values at profile read boundaries.
3. Before launch, Outfitter MUST resolve each adapter-declared state path to either a profile override strategy or the adapter default strategy.
4. Outfitter MUST reject profile `state_persistence` keys that are not declared by the selected adapter.
5. Outfitter MUST reject strategies that are not allowed for the adapter-declared state path.
6. For `symlink` strategy paths, Outfitter MUST materialize the composite profile path as a symlink to the resolved profile or native CLI source path.
7. For non-persistent strategies, Outfitter MUST materialize normal temporary composite profile paths and detect writes after the child agent exits.
8. Unknown writes MUST be governed by the adapter's `unknown` pseudo-path strategy and MUST NOT be persisted by symlink.
9. Outfitter MUST warn for `warn`, non-interactive `prompt`, and symlink-replacement state write issues, fail for `error` state write issues, and ignore `discard` state writes.
10. State path materialization MUST reject paths that escape the composite profile root.
11. During live composite profile updates, Outfitter MUST update generated composite profile files without re-materializing declared state paths so post-launch write detection can still observe agent changes to those paths.
12. When a declared `prompt` strategy path changed and the session is interactive (stdin and stdout are terminals), Outfitter MUST prompt after the agent exits with persist, discard, and always-persist-for-this-profile choices.
13. The persist choice MUST copy the composite profile change to the path's resolved durable source; the always choice MUST additionally record a `symlink` override in the selected local profile's `state_persistence`, and Outfitter MUST persist once and warn when the choice cannot be recorded (non-local selected profile or `symlink` not allowed for the path).
14. When the session is not interactive, changed `prompt` strategy paths MUST fall back to `warn` behavior with an explicit "prompt skipped: non-interactive" notice.
15. Undeclared writes governed by an `unknown: prompt` strategy MUST be reported as warnings with an explicit notice that undeclared writes cannot be persisted.

### OFTR-005.7: Generated Pi Prompt Export

1. Generated prompt export MUST be disabled unless effective settings or the selected resolved profile enables it.
2. Top-level settings `profile_export: true` MUST enable generated prompt export by default for selected local profiles.
3. Top-level profile `profile_export` MUST override the settings default when present.
4. Directory-layout profiles MUST export to `generated-system-prompt.md` under the selected profile directory.
5. Flat-layout profiles MUST export to sibling `<profile-id>.generated-system-prompt.md` without creating a resource directory.
6. Generated prompt export filenames MUST NOT include an agent or version suffix while only Pi prompt export is supported.
7. Before Pi starts, Outfitter MAY seed a deterministic fallback artifact that includes the selected profile ID, a Pi prompt-source label, the effective Pi `system_prompt`, and ordered effective Pi `append_system_prompt` entries.
8. For interactive Pi launches, Outfitter MUST pass the export path to its Pi launch extension and overwrite the fallback with the fully built Pi runtime system prompt from `ctx.getSystemPrompt()` when the session starts.
9. Outfitter MUST NOT mutate cache-backed or remote selected profile owners for generated prompt export and MUST emit an actionable warning when export is skipped for that reason.
10. Generated prompt export MUST NOT change launch args except for Outfitter's own runtime export extension plumbing, launch environment except for the export-path handoff, composite profile contents, or state persistence behavior.
11. During live composite profile updates, Outfitter SHOULD refresh generated prompt fallback artifacts when enabled.
