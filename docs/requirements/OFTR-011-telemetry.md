# OFTR-011: CLI Telemetry

## Overview

Outfitter collects a narrow, pseudonymous product-analytics signal for command adoption and
reliability. Telemetry must remain controllable, content-free, scope-aware, and unable to affect
normal CLI behavior when analytics infrastructure fails.

## Requirements

### OFTR-011.1: Consent and Control

1. Telemetry MUST default to enabled when no applicable setting exists and MUST print a one-time
   notice before the first capture.
2. Only user and user-local settings MAY explicitly enable telemetry. A false value in user,
   user-local, project, or project-local settings MUST disable telemetry. Remote and catalog
   settings MUST NOT enable telemetry.
3. Invalid loaded settings MUST fail closed.
4. `OUTFITTER_TELEMETRY=0` and `DO_NOT_TRACK=1` MUST disable capture for the process. CI detection
   MUST NOT change the effective consent.
5. `telemetry.enabled` in `~/.agents/settings.yml` MUST be the sole persistent user control and MUST
   be togglable by editing that file. The CLI MUST NOT expose a `telemetry` command.
6. When consent is disabled, Outfitter MUST automatically delete the pseudonymous installation
   identifier. The CLI and Pi setup completion flows MUST mention `telemetry.enabled: false` as the
   opt-out setting.

### OFTR-011.2: Data Minimization

1. Outfitter MUST capture only `cli command started` and `cli command completed`.
2. Event properties MUST be constructed from the documented allowlist and low-cardinality enums.
3. Outfitter MUST NOT capture command arguments, prompts, responses, paths, repository data, agent
   or profile names, settings, environment values, error details, session identifiers, or child
   process output.
4. Every capture MUST set `$process_person_profile` to false, and the PostHog client MUST disable
   GeoIP enrichment.

### OFTR-011.3: Pseudonymous State

1. The installation identifier MUST be a random UUID stored outside `~/.agents` under the Outfitter
   XDG state directory.
2. A blank `XDG_STATE_HOME` MUST be treated as unset.
3. The state file MUST be created lazily and MUST record whether the first-run notice was shown.
4. User-facing telemetry descriptions MUST consistently call the analytics pseudonymous.

### OFTR-011.4: Failure Isolation

1. Analytics failures MUST NOT change CLI stdout, stderr, behavior, or exit status.
2. PostHog requests MUST be aborted within the 1000 ms shutdown budget. Request failures and
   non-success responses MUST be converted to synthetic success responses before the SDK can log
   or retry them.
3. CLI shutdown MUST await the SDK's bounded shutdown and MUST NOT hold process exit beyond the
   1000 ms budget.
4. An empty compiled PostHog API key MUST keep telemetry inert without constructing a client,
   touching telemetry state, or printing a notice.

### OFTR-011.5: Executable Boundary

1. Instrumentation MUST occur only at the executable command lifecycle boundary.
2. The command name MUST be derived from registered top-level commands, with unrecognized values
   mapped to `unknown`.
3. Tests MUST inject telemetry clients and temporary homes so no test can send a production event or
   touch developer telemetry state when a real API key is compiled.

### OFTR-011.6: Continuous Integration

1. A detected CI run MUST use `ci.<vendor-id>` as its distinct identifier, where `<vendor-id>` is the
   lowercased `ci-info` vendor ID, or `ci.unknown` when no vendor is identified.
2. A detected CI run MUST NOT read or create persistent telemetry state.
3. A detected CI run MUST NOT print the first-run telemetry notice.
4. Both telemetry events MUST include `is_ci` and `ci_name`. `is_ci` MUST be a boolean. `ci_name` MUST
   be the lowercased `ci-info` vendor ID, `unknown` for CI without an identified vendor, or `none`
   outside CI.
5. `CI=false` (the exact string) MUST bypass CI detection and use the non-CI identity and state path.
