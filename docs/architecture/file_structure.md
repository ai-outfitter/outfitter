# Outfitter File Structure

This document records the key repository file and directory structure used by Outfitter.
See [`./README.md`](./README.md) for runtime file conventions such as `.outfitter` settings folders, profile folders, and generated composite profile directories.

## Repository Layout

Outfitter is organized around a private npm workspace root, clear TypeScript package boundaries, requirement documents, and scenario-based tests.

```text
.                                      # repository root
├── .deepreview                        # root DeepWork review rules for project-wide checks
├── .dockerignore                      # container build context exclusions
├── Dockerfile                         # local Outfitter container image definition
├── .deepwork/                         # DeepWork schemas and generated review instruction scratch files
│   └── schemas/                       # project-specific DeepSchema definitions
├── .github/                           # GitHub automation configuration
│   └── workflows/                     # GitHub Actions workflows and local .deepreview rules
├── docs/                              # documentation, architecture, requirements, plans, and specs
│   ├── architecture/                   # architecture and internal design docs
│   ├── documentation/                 # user-facing Outfitter docs
│   ├── requirements/                  # formal OUTFITTER requirement documents
│   └── specs/                         # detailed supporting specs
├── .prettierignore                    # Prettier ignore rules
├── .prettierrc.json                   # Prettier formatting configuration
├── .snapperrc.toml                    # Snapper Markdown formatting configuration
├── CONTRIBUTING.md                    # local install and contributor workflow guide
├── code/                              # npm workspace packages and license-separated code areas
│   ├── cli/                           # @ai-outfitter/outfitter npm package root
│   │   ├── eslint.config.js           # CLI package ESLint configuration
│   │   ├── package.json               # published package metadata, bin, files, and package-local scripts
│   │   ├── scripts/                   # package-local helper scripts
│   │   │   ├── dev-install.mjs        # npm-link installer for local CLI development
│   │   │   └── sync-package-assets.mjs # prepack staging for root README/license and enterprise notices
│   │   ├── skills/                    # Pi package skills published with Outfitter
│   │   ├── src/                       # production TypeScript source
│   │   │   ├── cli.ts                 # executable CLI entry point
│   │   │   ├── cli/                   # CLI parser construction and command objects
│   │   │   │   └── commands/profile/LintCommand.ts # `outfitter profile lint` implementation
│   │   │   ├── settings/              # settings loading and merging
│   │   │   ├── profiles/              # profile loading, validation, resolution, and merging
│   │   │   │   └── PromptIncludes.ts  # typed append_system_prompt include resolution and diagnostics
│   │   │   ├── merge/                 # deterministic value and array merge policy helpers
│   │   │   ├── compositeProfile/      # generated runtime composite profile assembly and watching
│   │   │   ├── agents/                # agent adapter boundary and CLI-specific adapters
│   │   │   ├── schemas/               # JSON Schema artifacts for persisted formats
│   │   │   └── validation/            # shared validation helpers
│   │   ├── tests/                     # automated CLI package tests and fixtures
│   │   ├── tsconfig.json              # strict package typecheck configuration
│   │   ├── tsconfig.build.json        # production emission from code/cli/src/ to code/cli/dist/
│   │   └── vitest.config.ts           # package test and coverage configuration
│   ├── doc_site/                      # Nextra/Next.js documentation website with separate npm lockfile
│   ├── enterprise/                    # enterprise/business licensed code; see code/enterprise/LICENSE
│   │   └── privateCatalog.js          # enterprise private profile catalog policy module used during package staging
│   └── pi-extension/                  # private workspace boundary for future Pi extension source/assets
├── bin/                               # local executable development helpers
├── scripts/                           # repository-level development, release, and formatting helper scripts
├── LICENSE.md                         # root source-available license notice
├── package-lock.json                  # locked npm workspace dependency graph
└── package.json                       # private npm workspace root and delegating scripts
```

The exact layout may evolve, but these boundaries should stay recognizable. Root scripts delegate to the `@ai-outfitter/outfitter` workspace so commands such as `npm run check-ci` continue to work from the repository root.

## Published Package Assets

The CLI package root is `code/cli`, but the npm package must still include repository-level notices. The CLI package `prepack` script runs `code/cli/scripts/sync-package-assets.mjs`, which stages `README.md`, `LICENSE.md`, `code/enterprise/LICENSE`, and `code/enterprise/README.md` inside `code/cli` before `npm pack` or `npm publish`.

## Test Fixtures

Integration fixtures should live under `code/cli/tests/fixtures/integration/` with full `home/`, `project/`, and optional `expected/` trees.
Fixture-backed integration tests and shared harness helpers should live under `code/cli/tests/integration/`.
The cross-adapter conformance suite (per-control declarations, the adapter runner, and the support-matrix drift check) lives under `code/cli/tests/conformance/` and runs standalone via `npm run conformance`.

Scenario fixtures should live under `code/cli/tests/fixtures/scenarios/`, for example:

```text
code/cli/tests/fixtures/scenarios/
  profile-cycle/
  profile-inheritance-chain/
  profile-missing-inheritance/
  profile-multiple-inheritance/
  profile-precedence/
```

Each scenario should include realistic `.outfitter` folders and expected resolution output.
