# BRIDL-REQ-001: Profile Wrapper Foundation

## Overview

Bridl provides a TypeScript-based wrapper for launching `pi` with repeatable, profile-scoped configuration. This placeholder requirement file captures the initial product direction while implementation details are still being designed.

## Requirements

### BRIDL-REQ-001.1: Profile Selection

1. The system MUST provide a way to select a named profile before launching `pi`.
2. Profile names MUST be stable identifiers suitable for use in commands, logs, and documentation.
3. The system SHOULD provide inspection output that explains which configuration sources a profile will apply.

### BRIDL-REQ-001.2: Pi Launch Environment

1. The system MUST treat `PI_CODING_AGENT_DIR` as the primary isolation boundary for profile-scoped pi configuration.
2. The system MUST support profile-controlled environment variables and pi CLI arguments.
3. The system SHOULD support explicit bootstrap extension injection with `--extension` or `-e` when profile behavior must run inside pi.
4. The system MUST NOT rely on pi extensions to choose the initial pi config directory, because extension loading happens after initial config directory discovery.

### BRIDL-REQ-001.3: Project Overrides

1. Each profile MUST define whether project-local `.pi` configuration is allowed, merged, or isolated away.
2. The selected project override policy MUST be visible in profile inspection output.
3. The system SHOULD provide a safe default that preserves pi's normal project-local behavior unless a profile explicitly requests stricter isolation.

### BRIDL-REQ-001.4: Credential Boundaries

1. The system MUST NOT copy credentials between profiles unless a requirement or explicit profile setting authorizes that behavior.
2. The system MUST support credential injection through environment variables or pi-supported auth mechanisms.
3. Profile documentation MUST state whether credentials are profile-local, environment-provided, or externally managed.
