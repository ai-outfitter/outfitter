# OFTR-001: Project Foundation

## Overview

Outfitter is a TypeScript CLI project.
This document specifies the baseline runtime, language, test, lint, and documentation conventions that must exist before feature work grows.

## Requirements

### OFTR-001.1: Runtime, Package Manager, and Language

Amendment (2026-08-08): statement 2 tied the published `engines.node` range to
the pinned development runtime, which shipped `>=24.18.0 <25` in every 1.x
release. npm resolves a bare `npm install -g @ai-outfitter/outfitter` as a
version range and silently selects the newest release whose `engines` the
running Node satisfies, so the upper bound did not warn — it installed 0.11.0
on Node 22.19+, 23.x, and 25+. Statement 2 now separates the two concerns and
statements 8 and 9 forbid an upper bound, because `.node-version` already
pins the tested runtime for CI.

1. The project MUST use TypeScript as its primary implementation language.
2. The project MUST pin the exact tested development and CI runtime version in `.node-version`.
3. TypeScript configuration MUST enable strict type checking.
4. The CLI workspace MUST provide a separate build TypeScript configuration that emits production files from `code/cli/src/` to `code/cli/dist/`.
5. The project MUST use npm as its package manager for the first version.
6. The project MUST commit `package-lock.json` after dependency installation or updates.
7. When an implementation library choice remains unclear, the project SHOULD prefer the same library or convention used by pi.dev.
8. Every published manifest MUST declare the same `engines.node` range, and that range MUST be `>=22.19.0`.
9. The `engines.node` range MUST NOT declare an upper bound, because npm answers an unsatisfiable bound by installing an older major release instead of failing.

### OFTR-001.2: Test Framework and Coverage

1. The project MUST use Vitest as its test framework before implementing substantial runtime behavior.
2. The test command MUST be runnable from package scripts.
3. The coverage command MUST use `@vitest/coverage-v8`.
4. The test configuration MUST enforce at least 99% global coverage for statements, branches, functions, and lines.
5. The coverage configuration MUST include all `code/cli/src/**/*.ts` files even when a source file is not imported by any test.
6. Tests that validate formal requirements MUST follow the traceability format required by OFTR-008.3.

### OFTR-001.3: Linting and Complexity

1. The project MUST configure ESLint with TypeScript support using `eslint`, `@eslint/js`, and `typescript-eslint`.
2. ESLint MUST enforce a maximum cyclomatic complexity of 10.
3. The lint command MUST be runnable from package scripts.
4. Production code SHOULD use small command objects and services so the complexity limit remains practical.

### OFTR-001.4: Persisted File Format Policy

1. User-editable persisted Outfitter configuration MUST use YAML instead of JSON unless the file is a JSON Schema.
2. Every user-editable YAML file format that Outfitter reads MUST have a corresponding JSON Schema.
3. Outfitter MUST validate YAML files against their JSON Schemas anywhere those files are read.
4. JSON Schema files MAY use JSON because schemas are tooling-facing validation artifacts.

### OFTR-001.5: Initial Dependency Set

Amendment (2026-07-01): statements 4, 5, 7, and 8 were removed and statement 10 was added, following the amendment process in `docs/requirements/README.md`. Rationale: `typebox`, `defu`, `glob`, and `hosted-git-info` were declared but never imported by any shipped source. Settings and profile merging is implemented by purpose-built merge code with policy-specific semantics (`code/cli/src/settings/SettingsMerger.ts`), profile discovery walks directories directly, and git URI handling is implemented in `code/cli/src/profiles/ProfileCache.ts`. Keeping the unused packages pinned only shipped supply-chain surface to every install.

1. The project MUST use Commander as the CLI framework.
2. The project MUST use `yaml` for YAML parsing and serialization.
3. The project MUST use AJV for runtime JSON Schema validation.
4. REQUIREMENT REMOVED (2026-07-01): TypeBox was never adopted; JSON Schemas are authored as JSON files under `code/cli/src/schemas/`.
5. REQUIREMENT REMOVED (2026-07-01): `defu` was never adopted; controlled settings and profile deep merging use documented merge-specific custom code.
6. The project MUST use `cross-spawn` for launching inner agent CLI processes.
7. REQUIREMENT REMOVED (2026-07-01): `glob` was never adopted; profile and resource discovery reads directories directly.
8. REQUIREMENT REMOVED (2026-07-01): `hosted-git-info` was never adopted; hosted git URI parsing is implemented in `ProfileCache`.
9. The project MAY use `chalk` for terminal diagnostics.
10. The CLI package MUST NOT declare production dependencies that are not imported by shipped source code.
