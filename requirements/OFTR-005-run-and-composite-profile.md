# OFTR-005: Run Command and Composite profile Lifecycle

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
7. When invoked before user setup has created `~/.outfitter/settings.yml`, the default `run` command MUST print `` `outfitter setup` has not been run yet - running now `` and execute setup before resolving the profile.

### OFTR-005.2: Composite profile Definition

1. Outfitter MUST call the dynamically assembled runtime configuration directory a `composite profile`.
2. A composite profile MUST be scoped to a resolved profile and a selected agent CLI.
3. Outfitter MUST create composite profile directories under the system temporary directory.
4. Outfitter SHOULD use composite profile paths that include a run-specific identifier to avoid collisions between concurrent runs.

### OFTR-005.3: Composite profile Assembly

1. Outfitter MUST assemble the composite profile from resolved profile layers in precedence order.
2. Outfitter MUST combine generic profile controls with CLI-specific overrides.
3. Each logical generated file in the composite profile MUST have an object instance representing it.
4. Each composite profile file object MUST know its source inputs and generated output path.
5. Each composite profile file object SHOULD expose its merge or transform strategy.

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
9. Outfitter MUST warn for `warn`, `prompt`, and symlink-replacement state write issues, fail for `error` state write issues, and ignore `discard` state writes.
10. State path materialization MUST reject paths that escape the composite profile root.
11. During live composite profile updates, Outfitter MUST update generated composite profile files without re-materializing declared state paths so post-launch write detection can still observe agent changes to those paths.
