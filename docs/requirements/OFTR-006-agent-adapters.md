# OFTR-006: Agent Adapters and Supported Harnesses

> **Transition (RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165)):** **OFTR-006.1 is amended (2026-07-17)** to the composition-projection model below (harnesses project a `CompositionPlan`, reporting unsupported _elements_).
> Some pi/claude launch-control sections still describe profile-era behavior and richer parity is projected incrementally. The current composition implementation includes Claude's isolated MCP config and Codex's additive MCP CLI overrides alongside the existing identity, skills, model, thinking, Pi extensions, and per-agent Pi configuration overlays.
> Target design: [docs/architecture/README.md](../architecture/README.md).

## Overview

Agent adapters translate generic Outfitter profile controls into native configuration files, environment variables, and command-line arguments for specific agent CLIs.
Pi is the default and primary supported adapter; Claude Code and Codex CLI are also supported through dedicated adapters.

## Requirements

### OFTR-006.1: Adapter Boundary

Amended (2026-07-17, RFC #165): adapters project a harness-neutral composition, not a profile.

1. Outfitter MUST project a harness-neutral `CompositionPlan` to a native harness launch: a materialized runtime configuration root plus a launch plan (command, args, environment).
2. Each harness projection MUST be identified by its harness (`pi`, `claude`, or `codex`).
3. Each harness projection MUST report which composition loadout elements it cannot project (`getUnsupportedElements`).
4. When a composition selects an element the harness cannot project, Outfitter MUST warn; `--strict` MUST make it fatal before launch.
5. Composition (resolver + composer) MUST stay independent of harness-specific projection.
6. Prompt templates MUST be projected only by harnesses that support a native prompt-template control; unsupported prompt-template use MUST be reported through `getUnsupportedElements` and MUST fail before launch under `--strict`.

### OFTR-006.2: Supported Adapter Availability

1. Outfitter MUST support the `pi` agent CLI on day one.
2. Outfitter MAY document other agent CLIs as roadmap adapters before implementing them.
3. Non-pi adapters MUST NOT be presented as supported until their adapter implementation and tests exist.
4. When generic Outfitter terminology conflicts with pi terminology, the pi adapter SHOULD prefer pi naming for generated pi artifacts and user-facing pi diagnostics.
5. Outfitter MUST keep `pi` as the default adapter when no adapter is selected explicitly or through settings.
6. Outfitter MUST support Claude Code through a `claude` adapter once implementation and tests are present.
7. Outfitter MUST support Codex CLI through a `codex` adapter once implementation and tests are present.

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
17. The pi adapter MUST overlay `agents/<agent>/pi/` directories from contributing `.agents` layers into the temporary `PI_CODING_AGENT_DIR`, with higher-precedence layers replacing matching paths, without following symlinks or projecting the overlay into non-Pi harnesses.
18. The pi adapter MUST project composed prompt fragments in composition order by passing one `--system-prompt`, ordered `--append-system-prompt` arguments, and `--prompt-template` when the composition declares a prompt template.
19. The pi adapter MUST default `PI_CODING_AGENT_SESSION_DIR` to pi's durable per-project session directory under pi's user agent directory, so sessions survive removal of the temporary `PI_CODING_AGENT_DIR`; it MUST leave an inherited `PI_CODING_AGENT_SESSION_DIR` in place, and MUST NOT override a pass-through `--session-dir` or `--no-session`.

### OFTR-006.4: Pi Startup Boundary

1. Outfitter MUST NOT rely on pi extensions to choose the initial pi configuration directory.
2. Outfitter MUST choose pi configuration paths before launching pi.
3. Outfitter MAY use explicit bootstrap extensions for behavior that can run after pi has discovered its initial configuration directory.
4. Post-start bootstrap extensions MUST clearly communicate when a selected profile or loadout applies only to the next `outfitter` launch.
5. Outfitter MUST document warnings when a requested pi control cannot be applied because pi startup order makes it impossible.

### OFTR-006.5: Claude Code Launch Controls

1. The Claude Code adapter MUST use `CLAUDE_CONFIG_DIR` as the primary profile-scoped Claude Code configuration boundary.
2. The Claude Code adapter MUST launch the native `claude` command.
3. The Claude Code adapter MUST support profile-controlled environment variables.
4. The Claude Code adapter MUST support profile-controlled pass-through Claude Code CLI arguments.
5. The Claude Code adapter SHOULD support `--model`, `--effort`, prompt control, and `--plugin-dir` where native Claude Code flags exist.
6. The Claude Code adapter MUST pass prompt documents with `--system-prompt-file` and `--append-system-prompt-file`, never the bare `--system-prompt` or `--append-system-prompt`. The bare flags take a prompt string, so a path is appended as literal text and the document is silently discarded.
7. The Claude Code adapter MUST pass at most one `--append-system-prompt-file`, concatenating the composed fragments in composition order, because a repeated occurrence discards every earlier one.
8. The Claude Code adapter SHOULD support `controls.session_directory` and `controls.claude.session_directory` by routing Claude `projects/` session state through Outfitter state persistence.
9. The Claude Code adapter MUST return unsupported-control warnings for requested generic or `controls.claude` controls that it cannot translate.
10. Until native support is implemented and tested, the Claude Code adapter MUST report `prompt_template` as unsupported and MUST NOT pass a pi-style prompt-template argument.
11. The Claude Code adapter MUST always pass the generated `mcp.json` through `--mcp-config` and MUST pass `--strict-mcp-config` so lower-layer MCP sources cannot break composition isolation, including when the composition selects zero MCP servers.
12. Before launch, the Claude Code adapter MUST seed an existing `~/.claude/.credentials.json` into the temporary `CLAUDE_CONFIG_DIR` as `.credentials.json` with mode `0600`, and MUST seed only the `oauthAccount` top-level key from `~/.claude.json` rather than copying the complete machine-local state file; missing or unreadable durable state MUST remain absent from the projection.
13. The Claude Code adapter MUST mirror `projects[<working-directory>].hasTrustDialogAccepted = true` into the projected `.claude.json` only when the durable `~/.claude.json` already records that accepted trust decision for the exact launch working directory; it MUST NOT project other project entries or grant trust for a path without that durable decision.
14. After a Claude Code launch exits or throws, the adapter MUST copy a projected `.credentials.json` back to `~/.claude/.credentials.json` with mode `0600`.
15. After a Claude Code launch exits or throws, the adapter MUST atomically merge a projected `oauthAccount` into `~/.claude.json` without replacing unrelated top-level or project state, and MUST leave malformed durable state untouched rather than clobbering it.

### OFTR-006.6: Codex CLI Launch Controls

1. The Codex adapter MUST launch the native `codex` command and MUST preserve pass-through arguments so callers can select interactive mode or the `exec` subcommand.
2. The Codex adapter MUST project model selection through `-m`.
3. For server ids containing only ASCII letters, digits, `_`, or `-`, the Codex adapter MUST project selected stdio MCP server `command`, `args`, `env`, and `cwd` fields through repeated `-c mcp_servers.<id>.<key>=<toml-value>` overrides. An `env` entry `${ENV_NAME}` MUST become an `env_vars` reference only when its key is also `ENV_NAME`; the adapter MUST warn and omit a reference that would rename the variable. Literal `env` entries MUST be projected and MUST warn that their values are exposed in process arguments. The adapter MUST warn and skip a server whose id contains other characters because Codex `-c` key paths cannot express it.
4. The Codex adapter MUST project selected HTTP MCP server fields through repeated `-c` overrides using `url` and `http_headers`, with `env_http_headers` for `${ENV_NAME}` values and `bearer_token_env_var` for `Authorization: Bearer ${ENV_NAME}`.
5. The Codex adapter MUST warn that MCP projection is additive because Codex has no strict MCP isolation mode; this adapter warning follows the normal `--strict` warning policy.
6. The Codex adapter MUST report every selected loadout element other than `model` and `mcp` as unsupported until a native projection is implemented and tested.

### OFTR-006.7: Pi Settings Reconciliation

1. When profile-controlled Pi extensions duplicate native Pi `settings.json` package entries, the pi adapter MUST avoid launching pi with both copies enabled.
2. The pi adapter MUST compare duplicate Pi extension and package entries by normalized resource identity rather than raw source string.
3. The pi adapter MUST preserve unrelated Pi settings and unrelated package entries when generating a reconciled runtime `settings.json`.
4. The pi adapter MUST keep reconciled runtime `settings.json` writes non-durable and declared so they are discarded without being reported as unknown state.
5. The pi adapter MUST fall back to native Pi `settings.json` state persistence when reconciliation is unnecessary or the settings file cannot be interpreted safely.

### OFTR-006.8: Outfitter Pi Interaction Defaults

1. The pi adapter MUST generate a runtime `keybindings.json` that reserves `shift+tab` for Outfitter mode switching and binds Pi thinking-level cycling to `ctrl+shift+t`.
2. The generated Pi keybindings file MUST preserve valid user or profile keybindings except for keys reserved by Outfitter's mode and thinking controls.
3. The generated Pi keybindings file MUST be non-durable runtime state so Outfitter's default shortcut policy does not overwrite user or profile keybinding sources.
4. Interactive Pi launches MUST inject an Outfitter bootstrap extension that consumes `shift+tab` before Pi's default thinking shortcut can handle it.
5. The Outfitter bootstrap extension MUST toggle between normal build mode and read-only plan mode.
6. Plan mode MUST restrict active tools to read-only inspection tools, exclude Bash from the active tool set, and block Bash tool calls while plan mode is active.
7. Interactive Pi launches SHOULD register a native `/outfitter` command for Outfitter-specific setup and profile management that can run without an agent turn.
8. Non-interactive Pi launches MUST NOT inject the Outfitter bootstrap extension.
