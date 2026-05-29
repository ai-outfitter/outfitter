# BRIDL-REQ-005: Run Command and Tack Lifecycle

## Overview

The `run` command assembles a temporary agent-specific configuration directory called a tack, launches the selected agent CLI, and keeps Bridl alive to manage the tack while the child process runs.

## Requirements

### BRIDL-REQ-005.1: Run Command Defaults

1. Bridl MUST provide a `run` command.
2. `run` MUST be the default command when no command is specified.
3. The default command behavior MUST be implemented with Commander rather than a custom `process.argv` parser.
4. The `run` command MUST accept `-p` and `--profile` options for selecting the profile.
5. The `run` command MUST use the resolved default profile when no profile option is provided.
6. The `run` command MUST pass unrecognized arguments through to the selected agent CLI unaltered.
7. When invoked before user setup has created `~/.bridl/settings.yml`, the default `run` command MUST print `` `bridl setup` has not been run yet - running now `` and execute setup before resolving the profile.

### BRIDL-REQ-005.2: Tack Definition

1. Bridl MUST call the dynamically assembled runtime configuration directory a `tack`.
2. A tack MUST be scoped to a resolved profile and a selected agent CLI.
3. Bridl MUST create tack directories under the system temporary directory.
4. Bridl SHOULD use tack paths that include a run-specific identifier to avoid collisions between concurrent runs.

### BRIDL-REQ-005.3: Tack Assembly

1. Bridl MUST assemble the tack from resolved profile layers in precedence order.
2. Bridl MUST combine generic profile controls with CLI-specific overrides.
3. Each logical generated file in the tack MUST have an object instance representing it.
4. Each tack file object MUST know its source inputs and generated output path.
5. Each tack file object SHOULD expose its merge or transform strategy.

### BRIDL-REQ-005.4: Tack Watching

1. Bridl MUST keep its process alive while the child agent CLI is running.
2. Bridl MUST use `fs.watch` or an equivalent Node file watching mechanism on tack input files while the child process is running.
3. Bridl MUST update generated tack files when watched inputs change and the generated output path remains inside the tack root.
4. Bridl MUST warn when a live update cannot be applied because regeneration or tack-root path validation fails.

### BRIDL-REQ-005.5: Unsupported Controls and Hard Tack

1. Bridl MUST write a warning to stderr when a profile requests a control that the selected agent adapter cannot support.
2. The `run` command MUST accept a `--hard-tack` option.
3. When `--hard-tack` is enabled, unsupported controls MUST cause tack assembly to fail instead of only warning.
4. Hard-tack failures MUST identify the unsupported control and selected agent CLI.

### BRIDL-REQ-005.6: Tack State Persistence

1. Profiles MAY define `state_persistence` entries that map adapter-declared state paths to persistence strategies.
2. Bridl MUST validate `state_persistence` values at profile read boundaries.
3. Before launch, Bridl MUST resolve each adapter-declared state path to either a profile override strategy or the adapter default strategy.
4. Bridl MUST reject strategies that are not allowed for the adapter-declared state path.
5. For `symlink` strategy paths, Bridl MUST materialize the tack path as a symlink to the resolved profile or native CLI source path.
6. For non-persistent strategies, Bridl MUST materialize normal temporary tack paths and detect writes after the child agent exits.
7. Unknown writes MUST be governed by the adapter's `unknown` pseudo-path strategy and MUST NOT be persisted by symlink.
8. Bridl MUST warn for `warn`, `prompt`, and symlink-replacement state write issues, fail for `error` state write issues, and ignore `discard` state writes.
9. State path materialization MUST reject paths that escape the tack root.
