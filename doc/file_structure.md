# Outfitter File Structure

This document records the key repository file and directory structure used by Outfitter.
See `doc/architecture.md` for runtime file conventions such as `.outfitter` settings folders, profile folders, and generated composite profile directories.

## Repository Layout

Outfitter is organized around clear TypeScript source boundaries, requirement documents, and scenario-based tests.

```text
.                                      # repository root
├── .deepreview                        # root DeepWork review rules for project-wide checks
├── .deepwork/                         # DeepWork schemas and generated review instruction scratch files
│   └── schemas/                       # project-specific DeepSchema definitions
├── .github/                           # GitHub automation configuration
│   └── workflows/                     # GitHub Actions workflows and local .deepreview rules
├── doc/                               # architecture, design, and specification docs
│   ├── .deepreview                    # documentation-specific DeepWork review rules
│   ├── architecture.md                # architectural rationale and runtime file conventions
│   ├── controllable-elements.md       # controllable element terminology and support matrix
│   ├── file_structure.md              # repository file structure overview
│   ├── integration_test_system.md     # fixture-backed integration test design
│   ├── state_writeback_strategy.md    # composite profile state persistence and writeback design
│   └── specs/                         # detailed supporting specs
├── doc_site/                          # Nextra/Next.js documentation website
│   ├── app/                           # App Router pages, layout, and site styles
│   ├── eslint.config.js               # documentation site ESLint configuration
│   ├── mdx-components.tsx             # Nextra MDX component bridge
│   ├── next.config.mjs                # Next.js configuration wrapped by Nextra
│   ├── package.json                   # documentation site package scripts and dependencies
│   └── tsconfig.json                  # documentation site TypeScript configuration
├── requirements/                      # formal OUTFITTER requirement documents
│   ├── OFTR-001-project-foundation.md
│   └── ...
├── .prettierignore                    # Prettier ignore rules
├── .prettierrc.json                   # Prettier formatting configuration
├── .snapperrc.toml                    # Snapper Markdown formatting configuration
├── plan.md                            # implementation plan
├── CONTRIBUTING.md                    # local install and contributor workflow guide
├── src/                               # production TypeScript source
│   ├── cli.ts                         # executable CLI entry point
│   ├── cli/                           # CLI parser construction and command registration
│   │   ├── OutfitterCli.ts
│   │   └── commands/                  # command objects for non-trivial CLI behavior
│   │       ├── CommandObject.ts
│   │       ├── FirstRunWelcomeProfile.ts
│   │       ├── PiLoginLaunch.ts
│   │       ├── RunCommand.ts
│   │       ├── SetupCommand.ts
│   │       ├── SyncCommand.ts
│   │       ├── WelcomeCommand.ts
│   │       └── profile/               # profile command namespace and subcommands
│   │           ├── Command.ts
│   │           ├── CreateCommand.ts
│   │           ├── ListCommand.ts
│   │           └── Shared.ts
│   ├── settings/                      # settings loading and merging
│   │   ├── Settings.ts
│   │   ├── SettingsLoader.ts
│   │   └── SettingsMerger.ts
│   ├── profiles/                      # profile loading, validation, resolution, and merging
│   │   ├── Profile.ts
│   │   ├── ProfileCache.ts
│   │   ├── ProfileLoader.ts
│   │   ├── ProfileMerger.ts
│   │   └── ProfileSource.ts
│   ├── merge/                         # reusable deterministic value and array merge policy helpers
│   │   ├── ArrayMergePolicy.ts
│   │   └── SettingsValueMerger.ts
│   ├── compositeProfile/              # generated runtime composite profile assembly and watching
│   │   ├── CompositeProfile.ts
│   │   ├── CompositeProfileAssembler.ts
│   │   ├── CompositeProfileFile.ts
│   │   ├── CompositeProfileTemplate.ts
│   │   ├── CompositeProfileWatcher.ts
│   │   └── StatePersistence.ts
│   ├── agents/                        # agent adapter boundary and CLI-specific adapters
│   │   ├── AdapterProfileControls.ts
│   │   ├── AdapterStatePaths.ts
│   │   ├── AgentAdapter.ts
│   │   ├── AgentRegistry.ts
│   │   ├── LaunchResources.ts
│   │   ├── ResourceIdentity.ts
│   │   ├── pi/                        # pi-specific adapter implementation
│   │   │   ├── PiAdapter.ts
│   │   │   ├── PiMcpConfig.ts
│   │   │   ├── PiSettingsMergePolicy.ts
│   │   │   └── PiCompositeProfileWriter.ts
│   │   └── claude/                    # Claude Code-specific adapter implementation
│   │       ├── ClaudeAdapter.ts
│   │       └── ClaudeCompositeProfileWriter.ts
│   ├── schemas/                       # JSON Schema artifacts for persisted formats
│   │   ├── settings.schema.json
│   │   ├── profile.schema.json
│   │   ├── profile-source.schema.json
│   │   └── SchemaDocument.ts
│   └── validation/                    # shared validation helpers
│       ├── SchemaValidator.ts
│       └── YamlDocument.ts
├── scripts/                           # local development and formatting helper scripts
│   ├── .deepreview                    # script-specific DeepWork review rules
│   └── run-snapper.mjs                # pinned Snapper binary downloader/runner
├── tests/                             # automated tests
│   ├── fixtures/                      # reusable test fixtures
│   │   ├── integration/               # fixture-backed integration scenarios, catalog, and local .deepreview
│   │   └── scenarios/                 # compact profile-resolution scenarios and expected outputs
│   ├── integration/                   # fixture-backed integration tests and harness helpers
│   ├── setup.ts                       # Vitest global setup for quiet test-output guards
│   ├── test-console.ts                # shared console-output guard helpers for tests
│   └── unit/                          # unit tests grouped by functionality under test, including welcome and first-run tests
├── package-lock.json                  # locked npm dependency graph
└── package.json                       # npm package metadata and scripts
```

The exact layout may evolve, but these boundaries should stay recognizable.

## Test Fixtures

Integration fixtures should live under `tests/fixtures/integration/` with full `home/`, `project/`, and optional `expected/` trees.
Fixture-backed integration tests and shared harness helpers should live under `tests/integration/`.

Scenario fixtures should live under `tests/fixtures/scenarios/`, for example:

```text
tests/fixtures/scenarios/
  profile-cycle/
  profile-inheritance-chain/
  profile-missing-inheritance/
  profile-multiple-inheritance/
  profile-precedence/
```

Each scenario should include realistic `.outfitter` folders and expected resolution output.
