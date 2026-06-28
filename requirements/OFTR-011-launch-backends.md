# OFTR-011: Launch Backends and Containerized Runs

## Overview

Launch backends transform an agent adapter launch plan into the final host process that Outfitter starts. The host backend preserves native execution. Container backends wrap the adapter launch plan in Docker, Podman, or Apple `container` CLI argv without invoking a shell.

## Requirements

### OFTR-011.1: Profile and Settings Contract

1. Profiles MAY define `controls.container` with `image`, `backend`, `pull`, `platform`, `env_passthrough`, and `run_args` fields.
2. Agent-specific controls MAY override generic container controls at `controls.pi.container` or `controls.claude.container`.
3. `backend` MUST be one of `host`, `auto`, `docker`, `podman`, or `apple-container`.
4. `pull` MUST be one of `missing`, `always`, or `never`.
5. Settings MAY define trusted local `default_launch_backend` and `container_policy.env_passthrough` values.
6. Remote cached settings MUST NOT be trusted to grant environment passthrough policy.

### OFTR-011.2: Backend Selection

1. Outfitter MUST select the launch backend with precedence: CLI `--launch-backend`, agent-specific profile backend, generic profile backend, trusted local settings `default_launch_backend`, then `host` when no image is configured or `auto` when an image is configured.
2. `auto` MUST resolve deterministically by checking Docker, then Podman, then Apple `container` on macOS.
3. Outfitter MUST fail before launch when a selected backend executable is unavailable.

### OFTR-011.3: Launch Wrapping

1. Agent adapters MUST continue to produce the inner agent launch plan.
2. Container launch backends MUST return the final host process launch plan.
3. `RunCommandResult.launchPlan` MUST expose the final plan, and `RunCommandResult.innerLaunchPlan` SHOULD expose the adapter plan when wrapping is applied.
4. Backend renderers MUST produce shell-free argv arrays.
5. The final process launcher MUST pass the resolved project directory as `cwd`.

### OFTR-011.4: Mount, Environment, and Warning Policy

1. Container backends MUST use conservative identity bind mounts for the project directory, composite profile root, contributing profile folders, package resources, cache directory, and adapter state source paths required by the launch.
2. Container backends MUST NOT implicitly mount the host home directory, filesystem root, container engine sockets, SSH credentials, or cloud credential directories.
3. Profiles MAY request environment variable names through `env_passthrough`, but Outfitter MUST pass only names allowed by trusted local `container_policy.env_passthrough`.
4. Outfitter MUST NOT render secret environment values in argv summaries or warnings.
5. Outfitter MUST warn for mutable image references using `latest` or no tag/digest, and `--strict` MUST make that warning fatal.
6. Apple `container` launches MUST warn when a profile requests unsupported portable pull policy behavior.
