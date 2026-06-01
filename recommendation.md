# Recommendation: Wrapping `pi` for Profiles and Startup Injection

## Summary

`pi` already has a strong native foundation for launching in different configurations.
A wrapper should primarily use separate `PI_CODING_AGENT_DIR` profile directories, then layer CLI flags and environment variables on top.
For early in-process behavior changes, use a bootstrap extension passed with `--extension` / `-e`; it loads early enough to register providers, tools, flags, and prompt behavior, but not early enough to alter the config directory or initial settings discovery.

## 1. Native pi mechanisms for different configurations

### Best native profile mechanism: separate agent directories

Pi supports changing the global agent/config directory with:

```bash
PI_CODING_AGENT_DIR=/path/to/profile-dir pi ...
```

In native pi, that directory can contain profile-scoped global state such as settings, auth, models, extensions, skills, prompts, themes, and sessions.

Bridl currently declares and materializes a narrower day-one state set for pi:

- `auth.json`
- `settings.json`
- `mcp.json`
- `plugins/`
- `cache/`
- `sessions/`
- `npm/`
- `git/`
- `utilities/`
- `bin/`

Native pi can be isolated by pointing `PI_CODING_AGENT_DIR` at a different directory. Bridl's implemented model uses that same boundary with a temporary tack directory for each run, then symlinks adapter-declared durable state paths back to profile files or native pi files such as `~/.pi/agent/auth.json`.

Conceptually:

```text
/tmp/bridl-default-pi-.../      # temporary tack used as PI_CODING_AGENT_DIR
profiles/default/cli_specific/pi/settings.json
~/.pi/agent/auth.json           # native fallback for login state
```

Launch shape:

```bash
PI_CODING_AGENT_DIR=/tmp/bridl-default-pi-... pi
```

This keeps the runtime tack disposable while preserving intentional credentials, settings, MCP configuration, plugins, caches, sessions, pi package stores, and pi-managed utilities through declared state paths. Bridl maps native pi package directories such as `npm/` and `git/` back to `~/.pi/agent/` so user-scoped `pi install` packages survive across runs. Bridl maps both tack `utilities/` and tack `bin/` to `<cache_directory>/utilities` by default so helper binaries such as `fd` and `rg` are reused across runs even though each tack directory is temporary.

### Other native launch controls

A wrapper can compose pi's existing CLI flags:

- Extensions:
  - `--extension` / `-e <path>`
  - `--no-extensions`
- Skills:
  - `--skill <path>`
  - `--no-skills`
- Prompt templates:
  - `--prompt-template <path>`
  - `--no-prompt-templates`
- Themes:
  - `--theme <path>`
  - `--no-themes`
- Context files:
  - `--no-context-files`
- System prompt:
  - `--system-prompt <text-or-file>`
  - `--append-system-prompt <text-or-file>`
- Models:
  - `--provider`
  - `--model`
  - `--models`
  - `--thinking`
- Credentials:
  - `--api-key`
  - provider env vars such as `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.
  - profile-specific `auth.json`
- Sessions:
  - `--session-dir`
  - `PI_CODING_AGENT_SESSION_DIR`
  - `--no-session`

### Project-local overrides

Pi also reads project-local configuration from:

```text
.pi/settings.json
.pi/extensions/
.pi/skills/
.pi/prompts/
.pi/themes/
.pi/SYSTEM.md
.pi/APPEND_SYSTEM.md
```

Project settings override global settings.
Bridl profiles control project-level behavior with one of these policies:

1. Global profile only via `PI_CODING_AGENT_DIR`.
2. Global profile plus current project's `.pi` overrides.
3. Isolated profile launched from a controlled cwd / temp workspace when project overrides should not apply.

## 2. Load order and injection opportunities

### High-level startup order

Pi roughly starts in this order:

1. Parse CLI args.
2. Determine `agentDir` from `PI_CODING_AGENT_DIR`.
3. Load startup settings to find session directory.
4. Resolve session and cwd.
5. Create runtime services:
   - settings manager
   - auth storage
   - model registry
   - resource loader
6. Resource loader reloads:
   - reads settings
   - resolves packages/resources
   - resolves explicit CLI extension sources
   - loads extensions
   - applies extension provider registrations
   - loads skills/prompts/themes/context files
   - resolves system prompt files / CLI prompt overrides
7. Select model/tools.
8. Start session.
9. Extensions receive session events and can modify behavior per turn.

### Useful injection point: `--extension`

Explicit CLI extensions are merged before configured/discovered extensions.
A wrapper can inject a bootstrap extension with:

```bash
pi -e /path/to/bootstrap-extension ...
```

A bootstrap extension can affect later startup/runtime behavior by:

- registering or overriding providers with `pi.registerProvider(...)`
- registering tools
- registering flags
- subscribing to extension events
- modifying the system prompt per turn via `before_agent_start`
- adding skills/prompts/themes through `resources_discover`
- coordinating model/tool behavior through extension APIs where available

This is the best hook for code that needs to run early inside pi.

### Limits of extension injection

A bootstrap extension does not run before everything.
It cannot cleanly affect:

- which `agentDir` is used
- initial settings file paths
- initial `settings.json` loading
- project/global settings precedence
- package/resource resolution that already happened before extensions load
- auth/model registry construction paths, except through provider registration or runtime credential mechanisms

Anything that must affect config paths, credential storage location, or initial settings discovery should be handled outside pi by the wrapper with environment variables and CLI args.

## Recommended wrapper design

### Treat profiles as first-class config directories

Each wrapper profile can map to something like:

```yaml
id: work
controls:
  environment:
    ANTHROPIC_API_KEY: ...optional...
    PI_OFFLINE: '1'
  model: anthropic/claude-sonnet-4
  thinking: medium
  extensions:
    - /path/to/bootstrap.ts
    - /path/to/team-extension
  system_prompt: /path/to/system.md
  append_system_prompt: /path/to/rules.md
  session_directory: ~/.bridl/work/sessions
```

Bridl persists this style of profile data as YAML, validates it with JSON Schema when read, and translates the resolved profile into a generated tack directory that becomes pi's `PI_CODING_AGENT_DIR`.

The wrapper would translate that into:

- `PI_CODING_AGENT_DIR`
- optional provider API env vars
- `PI_CODING_AGENT_SESSION_DIR` or `--session-dir`
- repeated `-e` / `--extension` args
- `--system-prompt` / `--append-system-prompt`
- model/tool flags

### Recommended layering

Use this priority model:

1. Wrapper profile env vars and CLI args.
2. Temporary tack `PI_CODING_AGENT_DIR` assembled from the resolved Bridl profile.
3. Adapter-declared state paths symlinked to profile or native pi sources.
4. Optional injected bootstrap extension.
5. Pi's normal project `.pi` overrides.
6. Pi's normal runtime behavior.

### Which mechanism to use

- Different credentials: profile/native state path symlinks, env vars, or `--api-key`.
- Different installed plugins/extensions: profile/native state path symlinks, or explicit `-e`.
- Temporary one-off extension: `pi -e ...`.
- Hard isolation from user config: set `PI_CODING_AGENT_DIR` to an empty/temp profile dir.
- Hard isolation from project config: launch from controlled cwd or use `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-context-files`.
- Different system prompts: `--system-prompt`, `--append-system-prompt`, or profile/project `SYSTEM.md` and `APPEND_SYSTEM.md`.
- Dynamic provider/model changes: bootstrap extension with `pi.registerProvider(...)`.

## Conclusion

Pi already has a native profile mechanism through `PI_CODING_AGENT_DIR`; Bridl uses a temporary tack at that boundary and makes durable writes explicit through declared state paths.

For early in-process injection, use `-e bootstrap-extension`.
It loads early enough to register providers/tools/flags and affect model availability and per-turn prompts, but not early enough to change config directory selection or initial settings discovery.
Those must be controlled by the wrapper before launching pi.
