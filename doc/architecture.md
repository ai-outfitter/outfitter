# Bridl Architecture

## Purpose

Bridl is a TypeScript CLI that assembles and launches reproducible agent-CLI profiles.
It is generic enough for organizations to define profiles once and run them across multiple agent CLIs, while supporting `pi` first, most deeply, and most natively.

Formal implementation requirements live in `requirements/`; this document explains the architectural shape behind those requirements.

> Naming rule: any occurrence of `bridle` in docs, prompts, examples, or generated text is a typo/autocorrect and MUST be treated as `bridl`.

## Architectural Principles

1. **TypeScript first**: production code, tests, schemas, and tooling are centered on TypeScript.
2. **Pi-native by default**: when uncertain, follow `pi.dev`/pi-coding-agent naming, behavior, and library choices.
3. **Generic control model**: user-facing profiles describe generic controllable elements, then adapters translate them to agent-specific files, flags, and environment variables.
4. **Command objects for complexity**: non-trivial CLI commands are implemented as command objects with explicit dependencies and typed inputs/outputs.
5. **YAML for persisted config**: user-editable persisted config uses `.yml`/`.yaml` rather than JSON so comments are possible.
6. **JSON Schema for validation**: every YAML file format has a corresponding JSON Schema used wherever the file is read.
7. **Deterministic merging**: settings and profile layers merge predictably using normal precedence: project-local, project, then user.
8. **Warn on partial support**: if a profile asks for a control an agent adapter cannot support, Bridl warns to stderr; `--hard-tack` makes unsupported controls fatal.
9. **Complete test coverage early**: the project starts with a test framework and a 100% global coverage requirement.
10. **Complexity limits early**: ESLint is configured immediately with maximum complexity `10`.

## Runtime and Tooling Baseline

- Runtime: Node.js `>=22.19.0`.
- Language: TypeScript.
- Package manager: npm.
  This matches the current pi-coding-agent package distribution model and gives Bridl a conventional `package-lock.json`-based install path.
- CLI framework: Commander `^14`.
  Commander is the initial choice because it supports default commands, command aliases, `allowUnknownOption`, pass-through argument collection, and testable parser construction without spawning child processes.
- Test framework: Vitest `^4` with `@vitest/coverage-v8`.
  Pi currently uses Vitest, and Vitest is well suited to TypeScript unit tests around command objects and generated launch plans.
- Coverage: 100% global threshold for statements, branches, functions, and lines from the first implementation.
- Linting: ESLint `^10`, `@eslint/js`, and `typescript-eslint`, with `complexity: ["error", 10]`.
- Schema and validation: TypeBox for schema authoring where TypeScript-schema coupling is useful, JSON Schema artifacts for persisted format contracts, and AJV for runtime validation.
- YAML: `yaml`, matching pi's dependency choice.
- Merge behavior: `defu`, so Bridl can use controlled deep defaults while documenting key-specific array behavior.
- Process launch: `cross-spawn`, matching pi's dependency choice and avoiding platform-specific spawn edge cases.
- Filesystem discovery and URI parsing: `glob` and `hosted-git-info`, aligned with pi where compatible with Node `>=22.19.0`.

### Initial npm Dependencies

Runtime dependencies in the first `package.json`:

- `commander`: CLI parsing, default command behavior, aliases, and pass-through argument support.
- `yaml`: YAML parsing and serialization for user-editable config.
- `ajv`: JSON Schema validation at file-read boundaries.
- `typebox`: Type-friendly schema definitions and schema-derived types where useful.
- `defu`: controlled deep merging for settings and profiles.
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

The project includes `tsconfig.json` for strict typechecking across source, tests, and config, plus `tsconfig.build.json` for production emission from `src/` to `dist/`.

## Repository File Structure

The repository layout and source/test directory boundaries live in `doc/file_structure.md`.

## Settings Resolution

Bridl uses a `.bridl` folder convention at multiple scopes:

```text
~/.bridl/
  settings.yml
  profiles
  cache/
    profiles/

<project>/.bridl/
  settings.yml
  profiles/

<project>/.bridl/local/
  settings.yml
  profiles/
```

All discovered `settings.yml` files are collectively referred to as Bridl settings.
The internal `Settings` object is the single conceptual result of reading all settings sources and applying precedence.

Note they are all the same in conceptual structure, with the exceptions that the <project>/.bridl/ contains the local one inside it, and the ~/.bridl includes the cache folder.

### Settings Precedence

Highest to lowest:

1. Project-local: `<project>/.bridl/local/settings.yml`
2. Project: `<project>/.bridl/settings.yml`
3. User: `~/.bridl/settings.yml`
4. Built-in defaults

Future sources can be added behind the same `SettingsLoader` abstraction.

### Required User Default Profile

`~/.bridl/settings.yml` MUST declare a default profile after setup completes.
This guarantees `bridl run` can resolve a profile even when no `--profile` is provided.

Example:

```yaml
# ~/.bridl/settings.yml
default_profile: user_default

profile_sources:
  - path: ./profiles
```

## Settings Schema

`settings.yml` supports:

```yaml
default_profile: engineering

profile_sources:
  - path: ./profiles
    only:
      - engineering
      - support

  - uri: git+https://github.com/example/company-bridl-profiles.git
    except:
      - experimental

profiles:
  engineering:
    # Inline profile fragments are allowed if schema support is retained.
```

Rules:

- Every settings file MUST validate against `settings.schema.json`.
- `profile_sources` entries MUST specify exactly one of `path` or `uri`.
- `only` and `except` are optional filters; without either, all profiles from the source are loaded.
- Relative `path` values are resolved relative to the settings file containing them.
- `uri` sources are fetched/cached by `bridl sync`.

## Profile Sources and Sync

A profile source can be local or URI-based.

### Local Source

```yaml
profile_sources:
  - path: ./profiles
```

The path points to a folder containing profile folders, not a specific profile folder.

### URI Source

```yaml
profile_sources:
  - uri: git+ssh://git@github.com/example/company-profiles.git#main
```

`bridl sync` fetches URI sources into:

```text
~/.bridl/cache/profiles/<encoded-uri>/
```

The encoded path must be filesystem-safe and deterministic for arbitrary URI strings, including non-GitHub URIs.

## Profile Layout

A profile is a folder with a required `profile.yml` file:

```text
profiles/
  engineering/
    profile.yml
    prompts/
    skills/
    extensions/
    cli_specific/
      pi/
      claude/
```

Example `profile.yml`:

```yaml
name: engineering
inherits:
  - base-typescript

agent:
  default_cli: pi

controls:
  model: anthropic/claude-sonnet-4
  system_prompt: ./prompts/system.md
  append_system_prompts:
    - ./prompts/company-policy.md
  skills:
    - ./skills/debugging
  extensions:
    - ./extensions/company-bootstrap
  env:
    ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}

pi:
  args:
    - --thinking
    - medium
```

Rules:

- Every `profile.yml` MUST validate against `profile.schema.json`.
- `inherits` is an ordered array of profile names.
- `cli_specific/<cli-name>/` contains files copied or translated directly into the generated tack for that CLI.
- CLI-specific configuration wins over generic controls when both apply to the same generated artifact.

## Profile Resolution and Inheritance

When `bridl run --profile X` is invoked, Bridl builds an ordered profile stack.

Highest to lowest precedence:

1. Project-local profile `X`
2. Project profile `X`
3. User profile `X`
4. URI/cache profile `X` according to source order
5. Profiles explicitly inherited by `X`, recursively, in declared order
6. The user default profile as an implicit bottom profile, recursively including its inherited profiles
7. Built-in defaults

Notes:

- Cycles in `inherits` MUST be detected and reported as validation errors.
- Profile merging should use `defu` or a similar controlled deep-merge utility.
- YAML merge behavior should be explicitly documented per key; arrays should not be blindly merged where order or duplication matters.

## Tack Model

A **tack** is the dynamically assembled runtime configuration directory for a specific profile and agent CLI.

Example term usage: “the tack for `data-analyst` on `claude`”.

Tacks are generated under the system temp directory so they can be reclaimed trivially:

```text
$TMPDIR/bridl/tacks/<run-id>/
```

During `bridl run`, the Bridl process remains alive while the child agent CLI runs.
It owns the tack lifecycle.

### Tack Assembly

`TackAssembler` resolves:

1. the requested profile stack;
2. generic controls;
3. CLI-specific overrides;
4. generated files;
5. child process env and argv.

Each logical file in the tack has an object instance, represented by `TackFile`, that knows:

- source inputs;
- generated output path;
- merge/transform strategy;
- validation rules;
- unsupported-control warnings;
- live synchronization behavior.

### Live Synchronization

While the child agent process runs:

- `fs.watch` runs on input files/folders used by each logical `TackFile`;
- changed inputs are revalidated and regenerated into the tack where safe;
- unsupported or unsafe live updates produce warnings;
- fatal tack errors stop the run only when `--hard-tack` is enabled or when the child CLI cannot continue safely.

## Agent Adapter Boundary

Each supported CLI has an `AgentAdapter` implementation.

```ts
interface AgentAdapter {
  readonly id: string;
  readonly supportedControls: readonly string[];
  readonly statePaths?: Readonly<Record<string, StatePathDeclaration>>;
  createTack(profile: Profile, input: AgentTackInput): AgentTackPlan;
  createLaunchPlan(tack: Tack, profile?: Profile, passThroughArgs?: readonly string[]): AgentLaunchPlan;
  getUnsupportedControls(profile: Profile): readonly string[];
}
```

The adapter owns CLI-specific details such as env vars, flags, state path declarations, warnings, and unsupported controls.

### Initial Adapter: Pi

Pi is the only day-one supported adapter.
Bridl should prefer native pi mechanisms:

- `PI_CODING_AGENT_DIR` for profile-scoped global state;
- `PI_CODING_AGENT_SESSION_DIR` or `--session-dir` for sessions;
- `--extension` / `-e` for explicit extensions;
- `--skill` for explicit skills;
- `--prompt-template` for prompt templates;
- `--system-prompt` and `--append-system-prompt` for prompts;
- model/provider/thinking flags where supported;
- copied/generated pi settings in the tack where flags/env are not the right mechanism.

If generic Bridl controls conflict with pi naming or behavior, prefer pi’s terminology and conventions.

## CLI Commands

### `bridl run`

`run` is the default command when no command is specified.

Examples:

```bash
bridl
bridl run
bridl run --profile engineering
bridl run -p support -- --model anthropic/claude-sonnet-4
```

Requirements:

- `-p` / `--profile` selects a profile.
- Without a selected profile, the unified settings default profile is used.
- Unknown args are passed through to the inner agent CLI unaltered.
- `--hard-tack` makes unsupported profile controls or tack assembly warnings fatal.
- The child agent CLI runs with the generated tack, env, and argv.

### `bridl setup`

Responsibilities:

- create `~/.bridl/settings.yml` when missing;
- create a default profile when missing;
- validate all discovered settings files;
- run `bridl sync` behavior for URI profile sources;
- report actionable next steps.

### `bridl sync`

Responsibilities:

- read settings;
- validate profile sources;
- fetch/update URI-based profile sources;
- store them under `~/.bridl/cache/profiles/<encoded-uri>/`;
- validate fetched profiles.

### `bridl create_profile`

Creates a placeholder profile folder at a requested scope.

Example shape:

```bash
bridl create_profile engineering --scope user
bridl create_profile support --scope project
bridl create_profile sandbox --scope project-local
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
    private readonly tackAssembler: TackAssembler,
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
- generated tack metadata: tack schema, if persisted;
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
- deterministic tests for unsupported controls and `--hard-tack`;
- scenario fixtures for common combinations instead of one-off bespoke setup.

Scenario fixture directory conventions are documented in `doc/file_structure.md`.
Each scenario should include realistic `.bridl` folders and expected resolution output.

## Settled Initial Decisions

1. Bridl uses npm and commits `package-lock.json`.
2. Bridl uses Commander for CLI parsing.
3. Bridl uses Vitest with V8 coverage for tests.
4. Bridl profile IDs are filesystem-safe slugs; optional display names can carry spaces or punctuation.
5. The public profile-creation command is `create_profile` to match the product requirement, with `create-profile` as an alias.
6. URI profile source lockfiles are deferred beyond v1; v1 sync records cache metadata but does not require lockfile-driven reproducibility.
7. Claude remains a documented roadmap adapter in `doc/controllable-elements.md`, but pi is the only supported day-one adapter.
