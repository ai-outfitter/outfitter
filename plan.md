# Bridl Phased Implementation Plan

This plan describes the order of work. Formal obligations live in `requirements/`.

## Phase 1: Project foundation — Done

- [x] Use npm with the committed `package.json` and `package-lock.json` as the dependency baseline.
- [x] Use Commander for CLI parsing, Vitest with V8 coverage for tests, ESLint with `typescript-eslint` for linting, and TypeScript strict mode.
- [x] Add the initial source layout for CLI command objects, settings, profiles, tack, adapters, schemas, and validation.
- [x] Wire CI-equivalent local commands: typecheck, lint, test, coverage.

## Phase 2: Schemas and configuration loading — Done

- [x] Define initial `settings.yml` and `profile.yml` JSON Schemas.
- [x] Implement YAML parsing and schema validation with useful diagnostics.
- [x] Implement `.bridl/settings.yml` discovery scaffolding across user, project, and project-local scopes.
- [x] Implement deterministic settings merging into the internal `Settings` object.

## Phase 3: Profile sources and profile resolution — Done

Merged in PR #6 (`phase-3-profile-resolution`).

- [x] Implement local profile source loading and `only` / `except` filters.
- [x] Implement profile folder validation and `profile.yml` parsing.
- [x] Implement profile scope precedence and merge behavior.
- [x] Implement inheritance resolution, default-profile inclusion, and cycle detection.
- [x] Add scenario fixtures for common source, inheritance, and precedence combinations.

## Phase 4: Setup and sync commands — Done

Implemented in `phase-4-setup-sync`.

- [x] Implement `setup` as a command object that creates initial user settings and a default profile.
- [x] Implement URI source cache path encoding.
- [x] Implement `sync` for URI-based profile sources.
- [x] Validate synced profiles and produce clear command output.
- [x] Implement `create_profile` and the `create-profile` alias against the same command object.

## Phase 5: Tack assembly core

- Implement tack directory creation in the system temp directory.
- Implement `TackFile` objects for logical generated files.
- Implement generic control merging with CLI-specific overrides.
- Implement unsupported-control warnings and `--hard-tack` fatal behavior.
- Implement file watching for tack inputs while the child process runs.

## Phase 6: Pi adapter and run command

- Implement the `AgentAdapter` abstraction.
- Implement the pi adapter using native pi environment variables, flags, and resource conventions.
- Implement `run` as the default command.
- Preserve pass-through arguments to pi.
- Add tests for generated pi launch env, argv, and tack files.

## Phase 7: Documentation and review hardening

- Keep `doc/architecture.md` aligned with implemented behavior.
- Keep `doc/controllable-elements.md` aligned with adapter support.
- Add user-facing examples to README after command behavior stabilizes.
- Run DeepWork reviews against requirements, schemas, tests, and docs.
- Close traceability gaps between requirements and automated tests or review rules.

## Settled implementation choices

- Package manager: npm.
- CLI framework: Commander.
- Test framework: Vitest with `@vitest/coverage-v8`.
- Merge library: `defu`.
- YAML parser: `yaml`.
- JSON Schema validator: AJV.
- Schema authoring helper: TypeBox where it improves TypeScript/schema alignment.
- Child process launcher: `cross-spawn`.
- Profile IDs: filesystem-safe slugs with optional separate display labels.
- Profile creation command: support both `create_profile` and `create-profile`.
- URI profile source lockfiles: deferred beyond v1.
- Adapter scope: pi supported day one; Claude remains roadmap documentation only.
