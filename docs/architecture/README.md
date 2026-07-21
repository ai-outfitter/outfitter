# Outfitter Architecture

## Purpose

Outfitter is a TypeScript CLI that resolves, composes, bakes, and launches agent configuration stored in the [Dotagents `.agents` protocol](https://dotagentsprotocol.com/) (pinned at revision `502a9d5`). It is generic enough for organizations to define resources once and run them across multiple agent CLIs, while supporting `pi` first and most deeply, plus Claude Code as an additional supported adapter.

Outfitter's differentiated value is source resolution, selective composition, task baking, validation, provenance, and harness projection — not ownership of a configuration format. The protocol tree is the source of truth and remains useful without Outfitter.

Formal implementation requirements live in [`../requirements/`](../requirements/); note the [transition status](../requirements/README.md) — this document describes the RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165) target architecture.

## Architectural Principles

1. **TypeScript first**: production code, tests, schemas, and tooling are centered on TypeScript.
2. **Protocol-native storage**: all authored configuration is a protocol `.agents` payload. Outfitter-specific metadata (settings, provenance) is optional, namespaced, and removable without losing the underlying resources. No parallel manifest, persona, or task YAML formats.
3. **Pin the protocol**: the implementation and its conformance fixtures target one pinned protocol revision. Protocol upgrades are deliberate, reviewed changes — never silent tracking of upstream `main`.
4. **One resolver**: listing, validation, task baking, running, and dumping share a single effective-resolution path. There is no code path that composes resources differently from another.
5. **Deterministic composition**: identical sources, refs, selections, and inputs produce identical results — the same effective identity for a run, and byte-identical output for a dump.
6. **Generic composition, adapter projection**: compositions are harness-neutral; adapters project them to agent-specific files, flags, and environment variables. If a composition asks for something an adapter cannot project, Outfitter warns to stderr; `--strict` makes it fatal.
7. **Pi-native by design**: pi is not merely the first adapter — targeting pi natively and completely is a deliberate design choice. Pi's configuration surface (extensions, plugins, subagents, keybindings, bootstrap) is treated as first-class, and the composition model is validated against it before being generalized to other harnesses. Claude Code is a supported additional adapter with documented gaps, not a co-equal design target.
8. **Command objects for complexity**: non-trivial CLI commands are implemented as command objects with explicit dependencies and typed inputs/outputs.
9. **Schema validation at boundaries**: every persisted file format read by Outfitter is validated at the read boundary (JSON Schema for JSON and YAML files, frontmatter schemas for markdown resources).
10. **Complete test coverage early**: the project maintains a test framework with a 100% global coverage requirement.
11. **Complexity limits early**: ESLint is configured with maximum complexity `10`.

## Runtime and Tooling Baseline

- Runtime: Node.js `>=22.19.0`.
- Language: TypeScript. Package manager: npm.
- CLI framework: Commander `^14` (default commands, aliases, `allowUnknownOption`, pass-through argument collection, testable parser construction).
- Test framework: Vitest `^4` with `@vitest/coverage-v8`; 100% global coverage thresholds.
- Linting: ESLint `^10`, `@eslint/js`, `typescript-eslint`, `complexity: ["error", 10]`.
- Schema and validation: TypeBox for schema authoring, JSON Schema artifacts for persisted contracts, AJV for runtime validation.
- YAML (`yaml`) for Outfitter settings; JSON for protocol files (`mcp.json`, `models.json`, `config.json`) per the protocol.
- Merge behavior: `defu` for settings; protocol merge-by-ID and JSON merge semantics implemented per the pinned revision with conformance fixtures.
- Process launch: `cross-spawn`. Discovery and URI parsing: `glob`, `hosted-git-info`. Diagnostics: `chalk`. Templating of generated harness files: `liquidjs` with Outfitter-specific delimiters.

The CLI workspace includes `code/cli/tsconfig.json` for strict typechecking and `code/cli/tsconfig.build.json` for production emission from `code/cli/src/` to `code/cli/dist/`.

## Repository File Structure

The repository layout and source/test directory boundaries live in [`./file_structure.md`](./file_structure.md).

## Onboarding

Pi-native first-run onboarding, `.agents` detection, and the `~/.claude` porting flow live in [`./onboarding.md`](./onboarding.md).

## Resource Model

Outfitter resolves protocol resources from layered `.agents` trees:

```text
~/.agents/                 # global layer
  agents.md
  system-prompt.md
  mcp.json
  models.json
  agents/<id>/agent.md     # + optional config.json
  skills/<id>/...
  tasks/<id>/task.md
  knowledge/...
  commands/...
  settings.yml             # Outfitter settings (namespaced, optional)
  settings.local.yml       # gitignored machine-local overrides
  cache/                   # synced remote sources (Outfitter-owned)

<project>/.agents/         # workspace overlay: same shape, minus cache
  settings.yml
  settings.local.yml
```

Remote sources (catalog repositories) supply additional layers below the local ones, in configured order. A standalone catalog repository's root _is_ the payload; a colocated source nests it under `.agents/` (selected with the source's `path:`).

### Resolution semantics

- Resources merge **by ID** across layers: workspace over global over remote sources in configured order. The winning definition replaces lower ones; there is no partial merge of markdown resources.
- JSON files (`mcp.json`, `models.json`, per-agent `config.json`) follow the protocol's JSON merge behavior across layers.
- The resolver produces one immutable **effective resource set** per invocation: every slug mapped to its winning source, with shadowed definitions retained for diagnostics.
- `list`, `validate`, `run`, and `dump` all consume the same effective resource set. This is a hard invariant, enforced by sharing one `Resolver` component.
- Conformance fixtures (layer trees + expected effective output) pin the merge semantics to the protocol revision; a protocol upgrade updates fixtures in the same change.

## Settings

Outfitter settings are the only Outfitter-specific files in a tree: `settings.yml` plus a flat sibling `settings.local.yml` at both scopes. There is no nested local settings directory.

### Precedence

Highest to lowest:

1. `<project>/.agents/settings.local.yml`
2. `<project>/.agents/settings.yml`
3. `~/.agents/settings.local.yml`
4. `~/.agents/settings.yml`
5. Cached remote settings referenced by `remote_settings`
6. Built-in defaults

The internal `Settings` object is the single conceptual result of reading all settings sources and applying precedence. Every settings file MUST validate against `settings.schema.json`.

### Schema

```yaml
default_agent: engineer # which agent runs by default
default_harness: pi # which harness to launch: pi or claude
cache_directory: ./cache

sources:
  - github: ai-outfitter/.agent
    ref: <commit-sha>
  - github: example/payments-service
    ref: v1.2.0
    path: .agents
  - uri: git+https://git.example.com/team/agents.git
    ref: main
  - path: ../shared-agents

remote_settings:
  - github: example/.outfitter
    ref: <commit-sha>
    path: .agents/settings.yml

state_persistence: {}
custom_settings: {}
```

Rules:

- Settings do not carry resource selections. An agent's loadout — skills, subagents, mcp, extensions, plugins, model, thinking, tools — is declared on the agent (`agents/<id>/agent.md` frontmatter or `config.json`), not in settings. There is no `profiles` map and no `default_profile`.
- `default_agent` names the agent plain `outfitter` runs; `default_harness` selects the harness (`pi` or `claude`).
- `sources` entries MUST specify a local `path`, a remote `uri`, or a `github` shorthand; remote entries accept `ref` and payload-subdirectory `path`. Relative `path` values resolve relative to the settings file containing them.
- `remote_settings` entries point at settings-style YAML files inside synced remote repositories; fetched by `outfitter sync` and loaded at lower precedence.
- `custom_settings` may contain arbitrary YAML-compatible nested data, deep-merged by precedence.

## Composition

For a selected agent, the composer builds the run's effective configuration from the effective resource set:

1. **Identity**: the tree's `system-prompt.md` is the base; `agents.md` contributes shared operating context; the selected agent's `agent.md` layers on top. Composition order is explicit and deterministic.
2. **Subagents**: agents named in the selected agent's `subagents` loadout are marked for projection into the harness's delegation surface.
3. **Skills**: skills named in the loadout are materialized (frontmatter `references`/`scripts`/`assets` resolved from their two-root model, validated for escapes and collisions) into generated skill directories.
4. **Harness elements**: extensions and plugins named in the loadout are marked for the adapter (first-class for pi).
5. **Structured configuration**: `models.json`, `mcp.json`, and per-agent `config.json` merge per protocol JSON semantics; the loadout's `model`, `thinking`, and `tools` select and constrain within them.

The composed result is a harness-neutral **composition plan** — the input to dump and adapter projection.

> **Tasks and bake** — freezing a named work contract and its typed inputs into an immutable execution artifact — are the subject of a [separate upcoming RFC](../documentation/tasks.md) and are not part of this architecture yet. The `ai-outfitter/actions` Action currently launches a composed agent headlessly with structured inputs through the same resolver.

## Dump

`outfitter dump` writes the effective resource set (or one selection's transitive closure) as a plain `.agents/` directory.

- Deterministic: byte-identical for identical inputs.
- Safe: never contains credentials, auth state, sessions, transcripts, caches, backups, mutable harness state, or symlinks resolving outside the tree. Dump shares the state-path knowledge of the adapters to guarantee exclusion.
- Protocol-shaped: valid payload for any protocol consumer; Outfitter provenance metadata is optional and removable.

## Generated-File Templating

Generated harness files may use LiquidJS templating with Outfitter-specific delimiters (`[[= expression ]]`, `[[% tag %]]`) so templates do not collide with agent prompt, skill, Handlebars, Mustache, Jinja, or Claude Code syntaxes. Plain `[[ -f file ]]` shell text passes through unchanged. The template context exposes resolved `custom_settings`, settings, the composition, the agent id, and the project root. Undefined output variables and unknown filters are template errors; undefined variables in conditions evaluate falsy. Source files are never rewritten; templating applies only to generated composition files.

## Runtime Model and State

A launch materializes the composed agent under the system temp directory:

```text
$TMPDIR/outfitter-<agent>-<harness>-<random>/
```

Adapter-declared state paths symlink to durable native CLI locations (`~/.pi/agent/...`, `~/.claude/...`) per the functional state model — see [`./state_writeback_strategy.md`](./state_writeback_strategy.md). State handling strategies are `symlink`, `discard`, `warn`, `error`, and `prompt`; unknown writes are never silently persisted. `state_persistence` policy lives in settings.

The Pi adapter reconciles generated runtime `settings.json` and `keybindings.json` (reserving `Shift+Tab` for Outfitter mode switching) as non-durable generated files. Interactive Pi launches inject the Outfitter bootstrap extension for build/plan mode switching; non-interactive launches skip it.

During `outfitter run`, the Outfitter process remains alive while the child agent CLI runs and owns the temporary composition lifecycle.

## Agent Adapter Boundary

Each supported CLI has an `AgentAdapter` implementation that projects a composition plan to native configuration:

```ts
interface AgentAdapter {
  readonly id: string;
  readonly supportedElements: readonly string[];
  readonly statePaths?: Readonly<Record<string, StatePathDeclaration>>;
  createProjection(
    composition: CompositionPlan,
    input: {
      readonly rootDirectory: string;
      readonly homeDirectory?: string;
      readonly cacheDirectory?: string;
      readonly settings?: Settings;
      readonly projectDirectory?: string;
    },
  ): AgentProjectionPlan;
  createLaunchPlan(projection: AgentProjection, passThroughArgs?: readonly string[]): AgentLaunchPlan;
  getUnsupportedElements(composition: CompositionPlan): readonly string[];
}
```

The adapter owns CLI-specific details: env vars, flags, state path declarations, warnings, and unsupported elements.

### Pi

Pi is the default adapter. Outfitter prefers native pi mechanisms: `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`/`--session-dir`, `--extension`, `--skill`, `--prompt-template`, `--system-prompt`/`--append-system-prompt`, model/provider/thinking flags, and generated settings reconciliation where flags are not the right mechanism. Startup-order-impossible requests surface as adapter warnings (`--strict` makes them fatal). If generic naming conflicts with pi behavior, prefer pi's terminology.

### Claude Code

Outfitter launches `claude` with `CLAUDE_CONFIG_DIR` pointing at the projection root and maps the elements supported by the current baseline adapter to native files and flags. Persistent state projection and managed harness symlinks are deferred to [#187](https://github.com/ai-outfitter/outfitter/issues/187); setup does not create them.

## CLI Commands

- **`outfitter run [agent]`** (default command): resolve → compose → project → launch. A positional agent slug selects what to run (default from settings `default_agent`); `--harness <pi|claude>` selects the harness (default from settings `default_harness`, then `pi`); unknown args pass through to the child CLI; `--strict` makes warnings fatal. Interactive clean-home launches start Pi-native onboarding; non-interactive clean-home launches require `outfitter setup` first.
- **`outfitter setup [source]`**: launch the bundled, model-free Pi walkthrough with the original three setup modes (default catalog, create a profile, or another catalog), original profile/target wording, and optional direct-source path; append only the default CLI-agent choice (Pi/Outfitter preselected); then atomically apply the result through the CLI state machine.
- **`outfitter sync`**: fetch/update remote sources and remote settings into the cache (`~/.agents/cache/repos/<encoded-uri-and-ref>/`), validate payloads, report per-source status, redact embedded credentials from output.
- **`outfitter list [kind]`**: report the effective resource set — slugs, winning sources, shadowed definitions — deterministically.
- **`outfitter validate [--strict] [--json]`**: protocol layout, frontmatter and JSON schemas, unresolved loadout slugs, skill reference escapes/collisions, settings schema.
- **`outfitter dump [--agent <id>] [--out]`**: write the deterministic tree, optionally restricted to one agent's transitive closure.

> `outfitter task bake` is deferred to the [tasks RFC](../documentation/tasks.md).

## Command Object Pattern

Each non-trivial command is a command object with explicit dependencies (`SettingsLoader`, `Resolver`, `Composer`, `Baker`, `ProcessRunner`) and typed inputs/outputs — no direct `process.argv` access inside command logic. Benefits: unit testability, low parser coupling, explicit dependencies, natural complexity limits.

## Validation Strategy

Validation happens at every file boundary: settings (`settings.schema.json`), protocol JSON files (schemas per the pinned revision), resource frontmatter, task input contracts, command inputs, and cache metadata. Diagnostics point to the file and key that failed where practical.

## Test Strategy

- Global coverage threshold: 100% for statements, branches, functions, and lines.
- **Protocol conformance fixtures**: layered `.agents` trees with expected effective resolution output, pinned to the protocol revision.
- Deterministic tests for settings precedence, persona composition order, task input validation, bake determinism (content-hash stability), dump byte-identity and hygiene (no credentials/state), cache path encoding, generated launch env/argv, and unsupported elements with `--strict`.
- Scenario fixtures for common combinations instead of one-off bespoke setup; conventions in [`./file_structure.md`](./file_structure.md).

## Settled Decisions

1. npm with committed `package-lock.json`; Commander; Vitest with V8 coverage.
2. Resource IDs are filesystem-safe slugs; display names live in frontmatter.
3. The protocol revision is pinned; upgrades are explicit, fixture-backed changes.
4. There is no legacy profile compatibility layer: no readers, writers, aliases, detection, or migration commands. The only old-version material is the manual migration reference routed from the bundled Outfitter skill.
5. A remote repository named `.outfitter` is supported only as a distribution convention for the new protocol payload.
6. Claude Code is supported as an additional adapter; pi remains the default.
