# Outfitter Architecture

## Purpose

Outfitter is a TypeScript CLI that assembles and launches reproducible agent-CLI profiles.
It is generic enough for organizations to define profiles once and run them across multiple agent CLIs, while supporting `pi` first and most deeply, plus Claude Code as an additional supported adapter.

Formal implementation requirements live in [`../requirements/`](../requirements/); this document explains the architectural shape behind those requirements.

## Architectural Principles

1. **TypeScript first**: production code, tests, schemas, and tooling are centered on TypeScript.
2. **Pi-native by default**: when uncertain, follow `pi.dev`/pi-coding-agent naming, behavior, and library choices.
3. **Generic control model**: user-facing profiles describe generic controllable elements, then adapters translate them to agent-specific files, flags, and environment variables.
4. **Command objects for complexity**: non-trivial CLI commands are implemented as command objects with explicit dependencies and typed inputs/outputs.
5. **YAML for persisted config**: user-editable persisted config uses `.yml`/`.yaml` rather than JSON so comments are possible.
6. **JSON Schema for validation**: every YAML file format has a corresponding JSON Schema used wherever the file is read.
7. **Deterministic merging**: settings and profile layers merge predictably using normal precedence: project-local, project, then user.
8. **Warn on partial support**: if a profile asks for a control an agent adapter cannot support, Outfitter warns to stderr; `--strict` makes unsupported controls fatal.
9. **Complete test coverage early**: the project starts with a test framework and a 100% global coverage requirement.
10. **Complexity limits early**: ESLint is configured immediately with maximum complexity `10`.

## Runtime and Tooling Baseline

- Runtime: Node.js `>=22.19.0`.
- Language: TypeScript.
- Package manager: npm.
  This matches the current pi-coding-agent package distribution model and gives Outfitter a conventional `package-lock.json`-based install path.
- CLI framework: Commander `^14`.
  Commander is the initial choice because it supports default commands, command aliases, `allowUnknownOption`, pass-through argument collection, and testable parser construction without spawning child processes.
- Test framework: Vitest `^4` with `@vitest/coverage-v8`.
  Pi currently uses Vitest, and Vitest is well suited to TypeScript unit tests around command objects and generated launch plans.
- Coverage: 100% global threshold for statements, branches, functions, and lines from the first implementation.
- Linting: ESLint `^10`, `@eslint/js`, and `typescript-eslint`, with `complexity: ["error", 10]`.
- Schema and validation: TypeBox for schema authoring where TypeScript-schema coupling is useful, JSON Schema artifacts for persisted format contracts, and AJV for runtime validation.
- YAML: `yaml`, matching pi's dependency choice.
- Merge behavior: `defu`, so Outfitter can use controlled deep defaults while documenting key-specific array behavior.
- Process launch: `cross-spawn`, matching pi's dependency choice and avoiding platform-specific spawn edge cases.
- Filesystem discovery and URI parsing: `glob` and `hosted-git-info`, aligned with pi where compatible with Node `>=22.19.0`.

### Initial npm Dependencies

Runtime dependencies in the CLI workspace `code/cli/package.json`:

- `commander`: CLI parsing, default command behavior, aliases, and pass-through argument support.
- `yaml`: YAML parsing and serialization for user-editable config.
- `ajv`: JSON Schema validation at file-read boundaries.
- `typebox`: Type-friendly schema definitions and schema-derived types where useful.
- `defu`: controlled deep merging for settings and profiles.
- `liquidjs`: safe Outfitter-time composite profile templating with custom delimiters that avoid common agent template syntaxes.
- `cross-spawn`: portable child process launch for agent CLIs.
- `glob`: profile/resource discovery.
- `hosted-git-info`: parsing hosted git URIs for sync/cache handling; pinned to the latest line compatible with Node `>=22.19.0`.
- `chalk`: readable terminal diagnostics.

Development dependencies:

- `typescript`
- `vitest`
- `@vitest/coverage-v8`
- `eslint`
- `@eslint/js`
- `typescript-eslint`
- `@types/node`
- `@types/cross-spawn`
- `shx`

The CLI workspace includes `code/cli/tsconfig.json` for strict typechecking across source, tests, and config, plus `code/cli/tsconfig.build.json` for production emission from `code/cli/src/` to `code/cli/dist/`.

## Repository File Structure

The repository layout and source/test directory boundaries live in [`./file_structure.md`](./file_structure.md).

## Onboarding

Pi-native first-run onboarding, generated extension behavior, custom profile picker details, and setup write boundaries live in [`./onboarding.md`](./onboarding.md).

## Settings Resolution

Outfitter uses a `.outfitter` folder convention at multiple scopes:

```text
~/.outfitter/
  settings.yml
  profiles
  cache/
    profiles/
    utilities/

<project>/.outfitter/
  settings.yml
  profiles/

<project>/.outfitter/local/
  settings.yml
  profiles/
```

All discovered `settings.yml` files are collectively referred to as Outfitter settings.
The internal `Settings` object is the single conceptual result of reading all settings sources and applying precedence.

Note they are all the same in conceptual structure, with the exceptions that the <project>/.outfitter/ contains the local one inside it, and the ~/.outfitter includes the cache folder.

### Settings Precedence

Highest to lowest:

1. Project-local: `<project>/.outfitter/local/settings.yml`
2. Project: `<project>/.outfitter/settings.yml`
3. User: `~/.outfitter/settings.yml`
4. Cached remote settings referenced by local settings
5. Built-in defaults

Additional sources can be added behind the same `SettingsLoader` abstraction.

### Required User Default Profile

`~/.outfitter/settings.yml` MUST declare a default profile after setup completes.
This guarantees `outfitter run` can resolve a profile even when no `--profile` is provided.

Example:

```yaml
# ~/.outfitter/settings.yml
default_profile: user_default

profile_sources:
  - path: ./profiles
```

A minimal user profile tree for that settings file looks like this:

```text
~/.outfitter/
  settings.yml
  profiles/
    user_default/
      profile.yml
      prompts/
        system.md
```

## Settings Schema

`settings.yml` supports:

```yaml
default_profile: engineering
default_agent: pi
cache_directory: ./cache
profile_export: true

profile_sources:
  - path: ./profiles
    only:
      - engineering
      - support

  - uri: git+https://github.com/example/company-outfitter-profiles.git
    ref: main
    path: profiles/team
    except:
      - experimental

  - github: example/outfitter-config
    ref: main
    path: profiles

remote_settings:
  - github: example/outfitter-config
    ref: main
    path: settings.yml

profiles:
  engineering:
    # Inline profile fragments are allowed if schema support is retained.
```

Rules:

- Every settings file MUST validate against `settings.schema.json`.
- `default_agent`, when present, selects the run adapter (`pi` or `claude`) used when `outfitter run --agent` is omitted.
- `profile_sources` entries MUST specify a local `path`, a remote `uri`, or a `github` shorthand.
- `only` and `except` are optional filters; without either, all profiles from the source are loaded.
- Local-only relative `path` values are resolved relative to the settings file containing them.
- `cache_directory` optionally selects the Outfitter cache root; relative values are resolved relative to the settings file containing them.
- `profile_export`, when true, writes generated Pi runtime prompt review artifacts for selected local profiles unless the profile overrides it.
- Remote `uri` and `github` profile sources can specify `ref` and repository-subdirectory `path` values.
- `remote_settings` entries point at settings-style YAML files inside synced remote repositories.
- `uri`, `github`, and `remote_settings` sources are fetched/cached by `outfitter sync`.
- `custom_settings` may contain arbitrary YAML-compatible nested data.
  Outfitter deep-merges custom settings objects using normal settings precedence; arrays and scalar values are replaced by the higher-precedence settings layer.

### Settings File Examples

A user settings file can select a default profile and expose user-managed profiles:

```yaml
# ~/.outfitter/settings.yml
default_profile: personal-engineering
cache_directory: ./cache

profile_sources:
  - path: ./profiles

custom_settings:
  build_commands:
    lint: npm run lint
    test: npm test
```

A project settings file can add checked-in project profiles and remote organizational profiles:

```yaml
# <project>/.outfitter/settings.yml
default_profile: project-engineering

profile_sources:
  - path: ./profiles
  - github: example/company-outfitter-config
    ref: main
    path: profiles/shared
    only:
      - base-typescript
      - secure-review

remote_settings:
  - github: example/company-outfitter-config
    ref: main
    path: settings.yml
```

A project-local settings file can override the default profile without changing checked-in files:

```yaml
# <project>/.outfitter/local/settings.yml
default_profile: local-sandbox

profile_sources:
  - path: ./profiles
```

## Composite profile Template Rendering

Outfitter renders Outfitter-time templates in generated composite profile files after profile and settings resolution and before writing the composite profile directory to disk.
Source settings files are never rewritten.

Outfitter uses LiquidJS with custom delimiters rather than common `{{ ... }}` / `{% ... %}` delimiters so templates do not collide with common agent prompt, skill, command, Handlebars, Mustache, Jinja, or Claude Code syntaxes.

Canonical delimiters:

```text
[[= expression ]]  output expression
[[% tag %]]        Liquid control tag, such as if, for, endif, or endfor
```

Outfitter only treats `[[=` and `[[%` as template openers, so plain shell or Bash expressions such as `[[ -f package.json ]]` pass through unchanged.

Template context:

```yaml
outfitter:
  custom_settings: # resolved settings.custom_settings
  settings: # resolved settings using YAML-style key names
  profile: # resolved profile object
  agent: pi
  project:
    root: /absolute/project/root
```

Example:

```yaml
# settings.yml
custom_settings:
  build_commands:
    lint: npm run lint
    test: npm test
```

```yaml
# any generated composite profile settings file containing Outfitter template delimiters
hooks:
  lint:
    command: "[[= outfitter.custom_settings.build_commands.lint ]]"

[[% if outfitter.custom_settings.build_commands.test %]]
  test:
    command: "[[= outfitter.custom_settings.build_commands.test ]]"
[[% endif %]]
```

Liquid loops and filters are available with the same custom tag and output delimiters:

```yaml
commands:
[[% for command in outfitter.custom_settings.commands %]]
  - "[[= command ]]"
[[% endfor %]]
```

Undefined output variables and unknown filters are template errors.
Undefined variables in `if`, `elsif`, and `unless` conditions are allowed and evaluate as falsy so templates can test optional custom settings.
Template errors identify the composite profile file being rendered and stop composite profile assembly.

## Profile Sources and Sync

A profile source can be local, URI-based, or GitHub shorthand-based.

### Local Source

```yaml
profile_sources:
  - path: ./profiles
```

The path points to a folder containing profile folders, not a specific profile folder.

### URI or GitHub Source

```yaml
profile_sources:
  - uri: git+ssh://git@github.com/example/company-profiles.git
    ref: main
    path: profiles/team

  - github: example/company-profiles
    ref: main
    path: profiles/team
```

The `github: owner/repo` shorthand normalizes to `git+https://github.com/owner/repo.git` internally.
Remote sources without `ref` or repository subpaths retain the original profile cache location for compatibility:

```text
~/.outfitter/cache/profiles/<encoded-uri>/
```

Remote sources that specify `ref`, repository-subdirectory `path`, or `github` are fetched into the shared repository cache:

```text
~/.outfitter/cache/repos/<encoded-uri-and-ref>/
```

Profile loading then reads from the requested subdirectory inside the cached repository.

### Remote Settings Source

```yaml
remote_settings:
  - github: example/outfitter-config
    ref: main
    path: settings.yml
```

`outfitter sync` fetches remote settings repositories into the shared repository cache, validates that the requested settings file exists, then loads cached remote settings as lower-precedence settings sources during later settings resolution.

## Profile Layout

A profile is a folder with a required `profile.yml` file:

```text
profiles/
  engineering/
    profile.yml
    prompts/
    skills/
    extensions/
    deepwork/
      jobs/
    cli_specific/
      pi/
      claude/
```

Example `profile.yml`:

```yaml
id: engineering
label: Engineering
description: General software engineering profile for coding, tests, reviews, and repo navigation.
template: false
inherits:
  - base-typescript

controls:
  model: anthropic/claude-sonnet-4
  system_prompt: ./prompts/system.md
  append_system_prompt:
    - file: ./prompts/company-policy.md
  skills:
    - ./skills/debugging
  extensions:
    - ./extensions/company-bootstrap
  environment:
    TEAM_MODE: engineering
    # Omit provider API keys here to inherit them from the parent environment.
  pi:
    args:
      - --thinking
      - medium
```

Rules:

- Every `profile.yml` MUST validate against `profile.schema.json`.
- `inherits` is an ordered array of profile names.
- `template: true` marks a profile as inheritance-only: it may contribute controls to runnable profiles through `inherits`, but `outfitter run --profile <id>` and `default_profile: <id>` launches reject it directly.
- `skills/` contains profile-bundled Agent Skills. Outfitter exposes valid skills from contributing profile folders when launching Pi.
- `deepwork/jobs/` contains profile-bundled DeepWork jobs. Outfitter appends contributing profile job folders to `DEEPWORK_ADDITIONAL_JOBS_FOLDERS` when launching Pi so DeepWork can discover profile-owned workflows.
  Profile-bundled jobs are isolated by default: inherited `DEEPWORK_ADDITIONAL_JOBS_FOLDERS` entries are included only when the profile sets `controls.pi.allow_external_deepwork_jobs: true`.
- `cli_specific/<cli-name>/` contains files copied or translated directly into the generated composite profile for that CLI, plus resources that intentionally apply only to one adapter.
- Pi profiles may provide `cli_specific/pi/.mcp.json`; Outfitter merges contributing profile fragments into the composite profile with unique array entries by identity and last writer wins for duplicate identities.
- Pi-specific skills and DeepWork jobs may also live under `cli_specific/pi/skills/` and `cli_specific/pi/deepwork/jobs/` when they should not be exposed to other adapters.
- `append_system_prompt` accepts literal strings, multiline strings, `{ file: string }` profile-source includes, `{ repo_file: string }` active-project includes, or an ordered list mixing those entry types. `{ text: ... }` is intentionally unsupported. `file` includes resolve from the declaring profile layer's source root (`~/.outfitter` for home profiles, the repository root for project/catalog `.outfitter/` and catalog `outfitter/` sources, or the explicit source path otherwise). `repo_file` includes resolve from the active project directory so reusable profiles can request project docs such as `docs/mission.md`. When multiple resolved profile layers provide append prompts, Outfitter composes the values into repeated agent append-prompt inputs in profile precedence order so shared prompt profiles do not need to use raw CLI `args`.
- Top-level `profile_export: true` on settings enables generated Pi prompt export by default for selected local profiles. Top-level `profile_export: true|false` on a profile overrides the settings default for that resolved profile.
- Generated Pi prompt exports are seeded before launch and overwritten by Outfitter's Pi runtime extension from `ctx.getSystemPrompt()`, the same Pi primitive used by `pi-inspect`. Directory profiles write `generated-system-prompt.md`; flat profiles write `<profile-id>.generated-system-prompt.md` beside the flat YAML file so teams can commit or git-ignore the fully built runtime prompt artifact.
- CLI-specific configuration wins over generic controls when both apply to the same generated artifact.

### Profile Directory Examples

A small user-level profile set can keep a base profile and a specialized profile side by side:

```text
~/.outfitter/profiles/
  base-typescript/
    profile.yml
    prompts/
      system.md
  personal-engineering/
    profile.yml
    prompts/
      system.md
    skills/
      debugging/
        SKILL.md
```

```yaml
# ~/.outfitter/profiles/base-typescript/profile.yml
id: base-typescript
label: Base TypeScript

controls:
  provider: anthropic
  model: anthropic/claude-sonnet-4
  thinking: medium
  system_prompt: ./prompts/system.md
  environment:
    NODE_ENV: development
```

```yaml
# ~/.outfitter/profiles/shared-prose/profile.yml
id: shared-prose
label: Shared Prose
template: true

controls:
  append_system_prompt:
    - file: ./prompts/prose.md
```

```yaml
# ~/.outfitter/profiles/personal-engineering/profile.yml
id: personal-engineering
label: Personal Engineering
inherits:
  - base-typescript
  - shared-prose

controls:
  append_system_prompt:
    - file: ./prompts/system.md
  skills:
    - ./skills/debugging
  pi:
    args:
      - --no-themes
```

If no resolved profile folder provides `cli_specific/<adapter>/<state-path>` for an adapter-declared symlink path, Outfitter falls back directly to the native CLI state location for that path, such as `~/.pi/agent/settings.json` or `~/.claude/settings.json`.
That native fallback is not a hidden base profile: it does not participate in `inherits`, cannot contribute profile controls, and only supplies durable symlink targets for declared CLI state.

A checked-in project profile set can add project-specific prompts and pi resources:

```text
<project>/.outfitter/profiles/
  project-engineering/
    profile.yml
    prompts/
      system.md
      review.md
    extensions/
      project-bootstrap/
        package.json
        src/
          index.ts
    cli_specific/
      pi/
        settings.json
```

```yaml
# <project>/.outfitter/profiles/project-engineering/profile.yml
id: project-engineering
label: Project Engineering
inherits:
  - base-typescript

controls:
  system_prompt: ./prompts/system.md
  append_system_prompt:
    - file: ./prompts/review.md
  extensions:
    - ./extensions/project-bootstrap
  session_directory: ./.outfitter/sessions/project-engineering
  pi:
    prompt_template: code-review
    args:
      - --model
      - anthropic/claude-sonnet-4
```

A local-only sandbox profile can use the highest-precedence project-local layer:

```text
<project>/.outfitter/local/
  settings.yml
  profiles/
    local-sandbox/
      profile.yml
      prompts/
        sandbox.md
```

```yaml
# <project>/.outfitter/local/profiles/local-sandbox/profile.yml
id: local-sandbox
label: Local Sandbox

controls:
  system_prompt: ./prompts/sandbox.md
  environment:
    OUTFITTER_EXPERIMENTAL_MODE: '1'
  pi:
    thinking: high
```

## Profile Resolution and Inheritance

When `outfitter run --profile X` is invoked, Outfitter builds an ordered profile stack for `X` only; the configured `default_profile` is selected only when no explicit profile is provided.

Highest to lowest precedence for the selected profile:

1. Project-local definition of the selected profile
2. Project definition of the selected profile
3. User definition of the selected profile
4. URI/cache definition of the selected profile according to source order
5. Profiles explicitly inherited by the selected profile, recursively, in declared order
6. Built-in defaults

Notes:

- Cycles in `inherits` MUST be detected and reported as validation errors.
- Profile merging should use `defu` or a similar controlled deep-merge utility.
- YAML merge behavior should be explicitly documented per key; arrays should not be blindly merged where order or duplication matters.

## Composite profile Model

A **composite profile** is the dynamically assembled runtime configuration directory for a specific profile and agent CLI.

Example term usage: “the composite profile for `data-analyst` on `claude`”.

Composite profiles are generated under the system temp directory so they can be reclaimed trivially, while adapter-declared state paths can be symlinked to durable profile, native CLI, or Outfitter cache locations:

```text
$TMPDIR/outfitter-<profile-id>-<agent-id>-<random>/
```

The pi adapter uses this state model for native pi state and for pi-managed utilities: most declared pi state paths, including `tmp/`, symlink to `~/.pi/agent/<path>` by default, while composite profile `utilities/` and `bin/` both symlink to `<cache_directory>/utilities` by default, so temporary composite profile cleanup does not force pi to redownload helper binaries such as `fd` and `rg`.

When profile-controlled Pi extensions would duplicate native Pi `settings.json` package entries, Outfitter generates a reconciled runtime `settings.json` inside the composite profile for that launch.
The generated file preserves unrelated settings and package entries, removes duplicate native package entries by normalized resource identity, and keeps the declared `settings.json` state path non-durable with `discard` write handling so runtime edits are not reported as unknown state.

Outfitter also generates a runtime Pi `keybindings.json` that reserves `Shift+Tab` for Outfitter mode switching and remaps Pi thinking-level cycling to `Ctrl+Shift+T`.
The generated keybindings file preserves valid user or profile keybindings except for those reserved keys and is non-durable runtime state, so the default Outfitter shortcut policy does not overwrite the user's native Pi keybindings file.
Interactive Pi launches inject an Outfitter bootstrap extension that consumes `Shift+Tab`, toggles build/plan mode, restricts plan mode to read-only inspection tools, and blocks Bash calls while plan mode is active; non-interactive Pi launches skip that extension.

During `outfitter run`, the Outfitter process remains alive while the child agent CLI runs.
It owns the composite profile lifecycle.

### Functional State Updating Model

Outfitter treats agent state updates as an explicit product behavior rather than an accidental side effect of temporary composite profile files.
Before launch, the selected adapter names the paths the agent CLI is expected to mutate, such as authentication files, settings files, plugin folders, caches, and sessions.
The resolved profile then chooses a functional persistence strategy for each path:

- `symlink`: writes are durable because the composite profile path points at a profile-managed or native CLI state path.
- `discard`: writes are allowed for the run but thrown away with the temporary composite profile.
- `warn`: writes are allowed and discarded, then reported after exit.
- `error`: writes are allowed during the run but make the Outfitter command fail after exit.
- `prompt`: reserved for future interactive handling; currently treated as a non-persistent diagnostic.

Unknown writes are handled separately from declared state paths.
They are never silently persisted because Outfitter has no declared durable destination for them.
The adapter's `unknown` policy decides whether to discard, warn, error, or eventually prompt.

The practical user model is:

1. Put durable, editable CLI state under `cli_specific/<agent>/` in a profile, or let Outfitter fall back to the native CLI state location.
2. Use `state_persistence` in `profile.yml` only for paths that should deviate from the adapter defaults.
3. Use `warn` or `error` for strict profiles and CI when unexpected state mutation should be visible.
4. Use `discard` for caches, sessions, or experimental state that should not outlive the run.

See [`./state_writeback_strategy.md`](./state_writeback_strategy.md) for the complete functional contract and the current pi path policy.

### Composite profile Assembly

`CompositeProfileAssembler` resolves:

1. the requested profile stack;
2. generic controls;
3. CLI-specific overrides;
4. generated files;
5. child process env and argv.

Each logical file in the composite profile has an object instance, represented by `CompositeProfileFile`, that knows:

- source inputs;
- generated output path;
- merge/transform strategy;
- validation rules;
- unsupported-control warnings;
- live synchronization behavior.

### Live Synchronization

While the child agent process runs:

- `fs.watch` runs on input files/folders used by each logical `CompositeProfileFile`;
- changed inputs are revalidated and regenerated into the composite profile where safe;
- unsupported or unsafe live updates produce warnings;
- fatal composite profile errors stop the run only when `--strict` is enabled or when the child CLI cannot continue safely.

## Agent Adapter Boundary

Each supported CLI has an `AgentAdapter` implementation.

```ts
interface AgentAdapter {
  readonly id: string;
  readonly supportedControls: readonly string[];
  readonly statePaths?: Readonly<Record<string, StatePathDeclaration>>;
  createCompositeProfile(
    profile: Profile,
    input: {
      readonly rootDirectory: string;
      readonly profilePaths: readonly string[];
      readonly profileFolders?: readonly string[];
      readonly homeDirectory?: string;
      readonly cacheDirectory?: string;
      readonly settings?: Settings;
      readonly projectDirectory?: string;
    },
  ): AgentCompositeProfilePlan;
  createLaunchPlan(
    compositeProfile: CompositeProfile,
    profile?: Profile,
    passThroughArgs?: readonly string[],
  ): AgentLaunchPlan;
  getUnsupportedControls(profile: Profile): readonly string[];
}
```

The adapter owns CLI-specific details such as env vars, flags, state path declarations, warnings, and unsupported controls.

### Supported Adapters: Pi and Claude Code

Pi is the default adapter for backward compatibility.
Outfitter should prefer native pi mechanisms:

- `PI_CODING_AGENT_DIR` for profile-scoped global state;
- `PI_CODING_AGENT_SESSION_DIR` or `--session-dir` for sessions;
- `--extension` / `-e` for explicit extensions;
- `--skill` for explicit skills;
- `--prompt-template` for prompt templates;
- `--system-prompt` and `--append-system-prompt` for prompts;
- model/provider/thinking flags where supported;
- generated Pi settings reconciliation in the composite profile where flags/env are not the right mechanism.

If generic Outfitter controls conflict with pi naming or behavior, prefer pi’s terminology and conventions.
Because Outfitter chooses `PI_CODING_AGENT_DIR` and other startup-sensitive configuration before launching pi, a requested pi control that would require changing startup discovery after pi has already begun cannot be applied by an extension or late runtime hook.
The pi adapter reports such unsupported or startup-order-impossible controls through normal adapter warnings, and `--strict` makes those warnings fatal.

Claude Code is also supported through the `claude` adapter.
Outfitter launches `claude` with `CLAUDE_CONFIG_DIR` pointing at the composite profile root, maps supported controls to native flags (`--model`, `--effort`, `--system-prompt`, `--append-system-prompt`, and repeated `--plugin-dir`), and preserves Claude Code state paths such as `settings.json`, `agents/`, `skills/`, `commands/`, `plugins/`, `projects/`, and `debug/` through adapter-declared state persistence.
Claude-specific profile overrides live under `controls.claude` and win over generic controls for Claude runs.

## CLI Commands

### `outfitter run`

`run` is the default command when no command is specified.

Examples:

```bash
outfitter
outfitter run
outfitter run --profile engineering
outfitter run -p support -- --model anthropic/claude-sonnet-4
outfitter run --agent claude -p support -- --permission-mode plan
```

Requirements:

- `-p` / `--profile` selects a profile.
- `--agent <pi|claude>` selects the agent adapter; if omitted, `default_agent` from settings is used, then `pi`.
- Without a selected profile, the unified settings default profile is used.
- On an interactive clean-home Pi launch with no user settings, Outfitter starts a temporary bootstrap profile, injects the native `/outfitter` command, and lets Pi-native onboarding write the selected user default profile for the next launch.
- Non-interactive clean-home launches do not run onboarding or mutate settings; users must run `outfitter setup` or provide settings first.
- Unknown args are passed through to the inner agent CLI unaltered.
- `--strict` makes unsupported profile controls or composite profile assembly warnings fatal.
- The child agent CLI runs with the generated composite profile, env, and argv.

### `outfitter setup`

Responsibilities:

- force Pi-native onboarding even when Outfitter settings already exist;
- start Pi with the bootstrap Outfitter extension and auto-submit `/outfitter`;
- accept an optional setup source URI, for example `outfitter setup https://github.com/example/outfitter-config`, and pass it into the generated Pi extension;
- keep setup writes inside the native `/outfitter` flow after Pi starts;
- set the process exit code from the launched Pi process.

### Pi-native `/outfitter` onboarding

Responsibilities:

- register `/outfitter` from the bootstrap extension with `pi.registerCommand("outfitter", ...)` so it executes as a native command before skill fallback dispatch;
- run without a model turn, using Pi `ctx.ui.*` through a small question abstraction because source inspection found the installed ask-user-question package exports tool registration but no supported direct questionnaire API for other extensions;
- list loaded default-profile choices from the synced `github: ai-outfitter/default-profiles`, `path: profiles` source and include `founder`, `engineer`, and `data_analyst` when that source is available;
- when launched from `outfitter setup <source>`, write the provided setup source from inside Pi after the user chooses an install target;
- write `~/.outfitter/settings.yml` with the shared default profile source and selected `default_profile` when settings are missing;
- update `default_profile` without overwriting existing user profile files when settings already exist;
- explain that selected profile/loadout changes apply on the next `outfitter` launch because Pi startup-sensitive state has already been chosen for the running process;
- keep the published `skills/outfitter` package skill as fallback guidance for environments where the native command is unavailable.

### `outfitter welcome`

Responsibilities:

- remain available as an explicit compatibility command for terminal welcome prompts;
- require an interactive TTY on both stdin and stdout before running welcome prompts;
- show welcome text that explains Outfitter and Pi before asking onboarding questions;
- return typed onboarding choices for compatibility with existing explicit setup behavior.

The Outfitter bootstrap extension checks Pi runtime model availability with `ctx.modelRegistry.getAvailable()` and opens Pi's native `/login` flow when interactive Pi reports no available models.
Credential collection stays inside Pi so provider API keys are not collected or persisted by Outfitter.
Pre-start `auth.json` or `models.json` checks may print interactive guidance, but runtime model availability is the authoritative login kickoff signal.

### `outfitter sync`

Responsibilities:

- read settings;
- validate profile sources;
- fetch/update URI-based, GitHub shorthand, and remote settings sources;
- store plain URI profile sources without `ref` or repository subpaths under `~/.outfitter/cache/profiles/<encoded-uri>/` for compatibility;
- store GitHub shorthand sources and sources with `ref` or repository subpaths under `~/.outfitter/cache/repos/<encoded-uri-and-ref>/`;
- validate fetched remote settings files and profiles;
- report whether each source was updated, unchanged, skipped, or failed;
- redact credentials embedded in source URIs from user-facing output.

### `outfitter profile list`

Lists profile IDs from configured local and cached remote profile sources.

Responsibilities:

- read and validate settings;
- load configured local and cached remote profile sources;
- hide template profiles by default because they are inheritance-only;
- include template profiles when `--all` is requested and mark them as templates in output;
- report unique profile IDs deterministically;
- use the highest-precedence loaded definition when duplicate profile IDs exist.

### `outfitter profile create`

Creates a placeholder profile folder at a requested scope.

Example shape:

```bash
outfitter profile create engineering --scope user
outfitter profile create support --scope project
outfitter profile create sandbox --scope project-local
```

Responsibilities:

- require an explicit destination scope or path;
- require a profile name;
- create `profile.yml` and conventional subfolders;
- optionally add the containing folder to `profile_sources` if needed;
- validate the generated profile.

## Command Object Pattern

Each non-trivial command should be implemented as a command object rather than embedding logic inside CLI parser callbacks.

```ts
class RunCommand {
  constructor(
    private readonly settingsLoader: SettingsLoader,
    private readonly profileLoader: ProfileLoader,
    private readonly composite profileAssembler: Composite profileAssembler,
    private readonly processRunner: ProcessRunner,
  ) {}

  async execute(input: RunCommandInput): Promise<RunCommandResult> {
    // parse-resolved inputs only; no direct process.argv access here
  }
}
```

Benefits:

- easier unit testing;
- lower CLI parser coupling;
- explicit dependencies;
- natural enforcement of complexity limits.

## Validation Strategy

Validation happens at every file boundary:

- settings read: `settings.schema.json`;
- profile read: `profile.schema.json`;
- generated composite profile metadata: composite profile schema, if persisted;
- command inputs: typed parser output plus runtime validation;
- URI cache metadata: schema-backed YAML.

YAML parsing should preserve helpful source locations where practical so diagnostics can point to the file and key that failed.

## Test Strategy

The test suite should be created before feature implementation becomes large.

Requirements:

- global coverage threshold: 100% for statements, branches, functions, and lines;
- deterministic tests for settings precedence;
- deterministic tests for profile inheritance and cycle detection;
- deterministic tests for URI cache path encoding;
- deterministic tests for generated pi launch env/argv;
- deterministic tests for unsupported controls and `--strict`;
- scenario fixtures for common combinations instead of one-off bespoke setup.

Scenario fixture directory conventions are documented in [`./file_structure.md`](./file_structure.md).
Each scenario should include realistic `.outfitter` folders and expected resolution output.

## Settled Initial Decisions

1. Outfitter uses npm and commits `package-lock.json`.
2. Outfitter uses Commander for CLI parsing.
3. Outfitter uses Vitest with V8 coverage for tests.
4. Outfitter profile IDs are filesystem-safe slugs; optional display names can carry spaces or punctuation.
5. Profile-management commands use a resource namespace: `profile list` and `profile create`.
6. URI profile source lockfiles are deferred beyond v1; v1 sync records cache metadata but does not require lockfile-driven reproducibility.
7. Claude Code is supported as an additional adapter, while pi remains the default adapter.
