# Recommendation: Wrapping `pi` for Profiles and Startup Injection

## Summary

`pi` already has a strong native foundation for launching in different configurations. A wrapper should primarily use separate `PI_CODING_AGENT_DIR` profile directories, then layer CLI flags and environment variables on top. For early in-process behavior changes, use a bootstrap extension passed with `--extension` / `-e`; it loads early enough to register providers, tools, flags, and prompt behavior, but not early enough to alter the config directory or initial settings discovery.

## 1. Native pi mechanisms for different configurations

### Best native profile mechanism: separate agent directories

Pi supports changing the global agent/config directory with:

```bash
PI_CODING_AGENT_DIR=/path/to/profile-dir pi ...
```

That directory controls the profile-scoped global state:

- `settings.json`
- `auth.json`
- `models.json`
- global `extensions/`
- global `skills/`
- global `prompts/`
- global `themes/`
- sessions, unless separately overridden

Recommended wrapper model:

```text
~/.bridl/work/
~/.bridl/personal/
~/.bridl/sandbox/
```

Launch example:

```bash
PI_CODING_AGENT_DIR=~/.bridl/work pi
```

This is the cleanest boundary for different credentials, plugins, default models, themes, prompts, and other user-level settings.

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

Project settings override global settings. Bridl profiles control project-level behavior with one of these policies:

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

Explicit CLI extensions are merged before configured/discovered extensions. A wrapper can inject a bootstrap extension with:

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

A bootstrap extension does not run before everything. It cannot cleanly affect:

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
agent_dir: ~/.bridl/work
env:
  ANTHROPIC_API_KEY: ...optional...
  PI_OFFLINE: "1"
args:
  - --model
  - anthropic/claude-sonnet-4
  - --thinking
  - medium
extensions:
  - /path/to/bootstrap.ts
  - /path/to/team-extension
system_prompt: /path/to/system.md
append_system_prompts:
  - /path/to/rules.md
session_dir: ~/.bridl/work/sessions
```

Bridl should persist this style of profile data as YAML and validate it with JSON Schema when read.

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
2. Profile-specific `PI_CODING_AGENT_DIR`.
3. Optional injected bootstrap extension.
4. Pi's normal project `.pi` overrides.
5. Pi's normal runtime behavior.

### Which mechanism to use

- Different credentials: separate `PI_CODING_AGENT_DIR`, env vars, or `--api-key`.
- Different installed plugins/extensions: separate `PI_CODING_AGENT_DIR`, or explicit `-e`.
- Temporary one-off extension: `pi -e ...`.
- Hard isolation from user config: set `PI_CODING_AGENT_DIR` to an empty/temp profile dir.
- Hard isolation from project config: launch from controlled cwd or use `--no-extensions`, `--no-skills`, `--no-prompt-templates`, `--no-context-files`.
- Different system prompts: `--system-prompt`, `--append-system-prompt`, or profile/project `SYSTEM.md` and `APPEND_SYSTEM.md`.
- Dynamic provider/model changes: bootstrap extension with `pi.registerProvider(...)`.

## Conclusion

Pi already has a native profile mechanism through `PI_CODING_AGENT_DIR`; this should be the core of `bridl`'s wrapper design.

For early in-process injection, use `-e bootstrap-extension`. It loads early enough to register providers/tools/flags and affect model availability and per-turn prompts, but not early enough to change config directory selection or initial settings discovery. Those must be controlled by the wrapper before launching pi.
