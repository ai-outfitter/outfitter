# BRIDL-REQ-006: Agent Adapters and Pi Support

## Overview

Agent adapters translate generic Bridl profile controls into native configuration files, environment variables, and command-line arguments for specific agent CLIs. Pi is the only day-one supported adapter.

## Requirements

### BRIDL-REQ-006.1: Adapter Boundary

1. Bridl MUST define an agent adapter abstraction for CLI-specific tack assembly and launch command generation.
2. Each adapter MUST expose an identifier for the agent CLI it supports.
3. Each adapter MUST report which controllable elements it supports.
4. Each adapter MUST return warnings for profile controls it cannot translate.
5. Bridl SHOULD keep generic profile resolution independent from adapter-specific file generation.

### BRIDL-REQ-006.2: Day-One Pi Adapter

1. Bridl MUST support the `pi` agent CLI on day one.
2. Bridl MAY document other agent CLIs as roadmap adapters before implementing them.
3. Non-pi adapters MUST NOT be presented as supported until their adapter implementation and tests exist.
4. When generic Bridl terminology conflicts with pi terminology, the pi adapter SHOULD prefer pi naming for generated pi artifacts and user-facing pi diagnostics.

### BRIDL-REQ-006.3: Pi Launch Controls

1. The pi adapter MUST use `PI_CODING_AGENT_DIR` as the primary profile-scoped pi configuration boundary.
2. The pi adapter MUST support profile-controlled environment variables.
3. The pi adapter MUST support profile-controlled pi CLI arguments.
4. The pi adapter SHOULD support `PI_CODING_AGENT_SESSION_DIR` or `--session-dir` for session location control.
5. The pi adapter SHOULD support `--extension` or `-e` for explicit extension injection.
6. The pi adapter SHOULD support `--skill` for explicit skill injection.
7. The pi adapter SHOULD support `--prompt-template` for prompt template injection.
8. The pi adapter SHOULD support `--system-prompt` and `--append-system-prompt` for prompt control.
9. The pi adapter SHOULD support pi model, provider, and thinking controls where native pi flags exist.

### BRIDL-REQ-006.4: Pi Startup Boundary

1. Bridl MUST NOT rely on pi extensions to choose the initial pi configuration directory.
2. Bridl MUST choose pi configuration paths before launching pi.
3. Bridl MAY use explicit bootstrap extensions for behavior that can run after pi has discovered its initial configuration directory.
4. Bridl MUST document warnings when a requested pi control cannot be applied because pi startup order makes it impossible.
