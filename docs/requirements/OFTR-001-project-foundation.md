# OFTR-001: Project Foundation

## Overview

Outfitter is a TypeScript CLI project.
This document specifies the baseline runtime, language, test, lint, and documentation conventions that must exist before feature work grows.

## Requirements

### OFTR-001.1: Runtime, Package Manager, and Language

1. The project MUST use TypeScript as its primary implementation language.
2. The project MUST declare Node.js `>=22.19.0` as the supported runtime baseline for the first version.
3. TypeScript configuration MUST enable strict type checking.
4. The CLI workspace MUST provide a separate build TypeScript configuration that emits production files from `code/cli/src/` to `code/cli/dist/`.
5. The project MUST use npm as its package manager for the first version.
6. The project MUST commit `package-lock.json` after dependency installation or updates.
7. When an implementation library choice remains unclear, the project SHOULD prefer the same library or convention used by pi.dev.

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

1. The project MUST use Commander as the CLI framework.
2. The project MUST use `yaml` for YAML parsing and serialization.
3. The project MUST use AJV for runtime JSON Schema validation.
4. The project SHOULD use TypeBox when TypeScript-friendly schema authoring is useful.
5. The project MUST use `defu` for controlled settings and profile deep merging unless a documented merge-specific reason requires custom code.
6. The project MUST use `cross-spawn` for launching inner agent CLI processes.
7. The project SHOULD use `glob` for profile and resource discovery.
8. The project SHOULD use `hosted-git-info` for hosted git URI parsing when the URI format is supported by that library.
9. The project MAY use `chalk` for terminal diagnostics.
