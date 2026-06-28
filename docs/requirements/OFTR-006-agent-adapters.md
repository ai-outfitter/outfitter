# OFTR-006: Agent Adapters, Pi Support, and Claude Code Support

## Overview

Agent adapters translate generic Outfitter profile controls into native configuration files, environment variables, and command-line arguments for specific agent CLIs.
Pi is the default and primary supported adapter; Claude Code is also supported through a dedicated adapter.

## Requirements

### OFTR-006.1: Adapter Boundary

1. Outfitter MUST define an agent adapter abstraction for CLI-specific composite profile assembly and launch command generation.
2. Each adapter MUST expose an identifier for the agent CLI it supports.
3. Each adapter MUST report which controllable elements it supports.
4. Each adapter MUST return warnings for profile controls it cannot translate.
5. Outfitter SHOULD keep generic profile resolution independent from adapter-specific file generation.

### OFTR-006.2: Supported Adapter Availability

1. Outfitter MUST support the `pi` agent CLI on day one.
2. Outfitter MAY document other agent CLIs as roadmap adapters before implementing them.
3. Non-pi adapters MUST NOT be presented as supported until their adapter implementation and tests exist.
4. When generic Outfitter terminology conflicts with pi terminology, the pi adapter SHOULD prefer pi naming for generated pi artifacts and user-facing pi diagnostics.
5. Outfitter MUST keep `pi` as the default adapter when no adapter is selected explicitly or through settings.
6. Outfitter MUST support Claude Code through a `claude` adapter once implementation and tests are present.

### OFTR-006.3: Pi Launch Controls

1. The pi adapter MUST use `PI_CODING_AGENT_DIR` as the primary profile-scoped pi configuration boundary.
2. The pi adapter MUST support profile-controlled environment variables.
3. The pi adapter MUST support profile-controlled pi CLI arguments.
4. The pi adapter SHOULD support `PI_CODING_AGENT_SESSION_DIR` or `--session-dir` for session location control.
5. The pi adapter SHOULD support `--extension` or `-e` for explicit extension injection.
6. The pi adapter SHOULD support `--skill` for explicit skill injection.
7. The pi adapter SHOULD support `--prompt-template` for prompt template injection.
8. The pi adapter SHOULD support `--system-prompt` and `--append-system-prompt` for prompt control.
9. The pi adapter SHOULD support pi model, provider, and thinking controls where native pi flags exist.
10. The pi adapter MUST merge `.mcp.json` files from contributing `cli_specific/pi/` profile folders into the composite profile, adding unique array entries by identity while keeping the last entry for duplicate identities.
11. The pi adapter MUST make native Pi `models.json` available inside the composite profile so custom providers and model definitions are visible before Pi resolves `--provider` and `--model` flags.
12. The pi adapter MUST expose valid Agent Skills from contributing profile `skills/` folders as `--skill` arguments, and MAY also expose Pi-specific skills from `cli_specific/pi/skills/`.
13. The pi adapter MUST expose DeepWork jobs from contributing profile `deepwork/jobs/` folders through `DEEPWORK_ADDITIONAL_JOBS_FOLDERS`, and MAY also expose Pi-specific jobs from `cli_specific/pi/deepwork/jobs/`.
14. The pi adapter MUST resolve `controls.deepwork.jobs` entries as DeepWork job names from shared Outfitter job roots such as `.outfitter/deepwork/jobs/<job-name>/job.yml` and expose the matching jobs root through `DEEPWORK_ADDITIONAL_JOBS_FOLDERS`.
15. The pi adapter MUST NOT treat flat profile source roots as profile-bundled job folders unless a named DeepWork job resolves to a shared jobs root.
16. The pi adapter MUST ignore inherited external `DEEPWORK_ADDITIONAL_JOBS_FOLDERS` values unless `controls.pi.allow_external_deepwork_jobs` is true.

### OFTR-006.4: Pi Startup Boundary

1. Outfitter MUST NOT rely on pi extensions to choose the initial pi configuration directory.
2. Outfitter MUST choose pi configuration paths before launching pi.
3. Outfitter MAY use explicit bootstrap extensions for behavior that can run after pi has discovered its initial configuration directory.
4. Outfitter MUST document warnings when a requested pi control cannot be applied because pi startup order makes it impossible.

### OFTR-006.5: Claude Code Launch Controls

1. The Claude Code adapter MUST use `CLAUDE_CONFIG_DIR` as the primary profile-scoped Claude Code configuration boundary.
2. The Claude Code adapter MUST launch the native `claude` command.
3. The Claude Code adapter MUST support profile-controlled environment variables.
4. The Claude Code adapter MUST support profile-controlled pass-through Claude Code CLI arguments.
5. The Claude Code adapter SHOULD support `--model`, `--effort`, `--system-prompt`, `--append-system-prompt`, and `--plugin-dir` where native Claude Code flags exist.
6. The Claude Code adapter SHOULD support `controls.session_directory` and `controls.claude.session_directory` by routing Claude `projects/` session state through Outfitter state persistence.
7. The Claude Code adapter MUST return unsupported-control warnings for requested generic or `controls.claude` controls that it cannot translate.

### OFTR-006.6: Pi Settings Reconciliation

1. When profile-controlled Pi extensions duplicate native Pi `settings.json` package entries, the pi adapter MUST avoid launching pi with both copies enabled.
2. The pi adapter MUST compare duplicate Pi extension and package entries by normalized resource identity rather than raw source string.
3. The pi adapter MUST preserve unrelated Pi settings and unrelated package entries when generating a reconciled runtime `settings.json`.
4. The pi adapter MUST keep reconciled runtime `settings.json` writes non-durable and declared so they are discarded without being reported as unknown state.
5. The pi adapter MUST fall back to native Pi `settings.json` state persistence when reconciliation is unnecessary or the settings file cannot be interpreted safely.

### OFTR-006.7: Outfitter Pi Interaction Defaults

1. The pi adapter MUST generate a runtime `keybindings.json` that reserves `shift+tab` for Outfitter mode switching and binds Pi thinking-level cycling to `ctrl+shift+t`.
2. The generated Pi keybindings file MUST preserve valid user or profile keybindings except for keys reserved by Outfitter's mode and thinking controls.
3. The generated Pi keybindings file MUST be non-durable runtime state so Outfitter's default shortcut policy does not overwrite user or profile keybinding sources.
4. Interactive Pi launches MUST inject an Outfitter bootstrap extension that consumes `shift+tab` before Pi's default thinking shortcut can handle it.
5. The Outfitter bootstrap extension MUST toggle between normal build mode and read-only plan mode.
6. Plan mode MUST restrict active tools to read-only inspection tools, exclude Bash from the active tool set, and block Bash tool calls while plan mode is active.
7. Non-interactive Pi launches MUST NOT inject the Outfitter bootstrap extension.
