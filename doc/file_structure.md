# Bridl File Structure

This document records the key repository file and directory structure used by Bridl.
See `doc/architecture.md` for runtime file conventions such as `.bridl` settings folders, profile folders, and generated tack directories.

## Repository Layout

Bridl is organized around clear TypeScript source boundaries, requirement documents, and scenario-based tests.

```text
.                                      # repository root
├── doc/                               # architecture, design, and specification docs
│   ├── architecture.md                # architectural rationale and runtime file conventions
│   ├── controllable-elements.md       # controllable element terminology and support matrix
│   ├── file_structure.md              # repository file structure overview
│   ├── integration_test_system.md     # fixture-backed integration test design
│   ├── state_writeback_strategy.md    # tack state persistence and writeback design
│   └── specs/                         # detailed supporting specs
├── doc_site/                          # Nextra/Next.js documentation website
│   ├── app/                           # App Router pages, layout, and site styles
│   ├── eslint.config.js               # documentation site ESLint configuration
│   ├── mdx-components.tsx             # Nextra MDX component bridge
│   ├── next.config.mjs                # Next.js configuration wrapped by Nextra
│   ├── package.json                   # documentation site package scripts and dependencies
│   └── tsconfig.json                  # documentation site TypeScript configuration
├── requirements/                      # formal BRIDL requirement documents
│   ├── BRIDL-REQ-001-project-foundation.md
│   └── ...
├── .prettierignore                    # Prettier ignore rules
├── .prettierrc.json                   # Prettier formatting configuration
├── .snapperrc.toml                    # Snapper Markdown formatting configuration
├── plan.md                            # implementation plan
├── contributor.md                     # local install and contributor workflow guide
├── src/                               # production TypeScript source
│   ├── cli/                           # CLI parser construction and command registration
│   │   ├── BridlCli.ts
│   │   └── commands/                  # command objects for non-trivial CLI behavior
│   │       ├── RunCommand.ts
│   │       ├── SetupCommand.ts
│   │       ├── SyncCommand.ts
│   │       └── CreateProfileCommand.ts
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
│   ├── tack/                          # generated runtime tack assembly and watching
│   │   ├── Tack.ts
│   │   ├── TackAssembler.ts
│   │   ├── TackFile.ts
│   │   ├── TackTemplate.ts
│   │   ├── TackWatcher.ts
│   │   └── StatePersistence.ts
│   ├── agents/                        # agent adapter boundary and CLI-specific adapters
│   │   ├── AdapterProfileControls.ts
│   │   ├── AdapterStatePaths.ts
│   │   ├── AgentAdapter.ts
│   │   ├── AgentRegistry.ts
│   │   ├── pi/                        # pi-specific adapter implementation
│   │   │   ├── PiAdapter.ts
│   │   │   └── PiTackWriter.ts
│   │   └── claude/                    # Claude Code-specific adapter implementation
│   │       ├── ClaudeAdapter.ts
│   │       └── ClaudeTackWriter.ts
│   ├── schemas/                       # JSON Schema artifacts for persisted formats
│   │   ├── settings.schema.json
│   │   ├── profile.schema.json
│   │   └── profile-source.schema.json
│   └── validation/                    # shared validation helpers
│       └── SchemaValidator.ts
├── scripts/                           # local development and formatting helper scripts
│   └── run-snapper.mjs                # pinned Snapper binary downloader/runner
├── tests/                             # automated tests
│   ├── fixtures/                      # reusable test fixtures
│   │   ├── integration/               # fixture-backed integration scenarios and catalog
│   │   └── scenarios/                 # compact profile-resolution scenarios and expected outputs
│   ├── integration/                   # fixture-backed integration tests and harness helpers
│   └── unit/                          # unit tests grouped by functionality under test
├── package-lock.json                  # locked npm dependency graph
└── package.json                       # npm package metadata and scripts
```

The exact layout may evolve, but these boundaries should stay recognizable.

## Test Fixtures

Integration fixtures should live under `tests/fixtures/integration/` with full `home/`, `project/`, and optional
`expected/` trees. Fixture-backed integration tests and shared harness helpers should live under `tests/integration/`.

Scenario fixtures should live under `tests/fixtures/scenarios/`, for example:

```text
tests/fixtures/scenarios/
  profile-cycle/
  profile-inheritance-chain/
  profile-missing-inheritance/
  profile-multiple-inheritance/
  profile-precedence/
```

Each scenario should include realistic `.bridl` folders and expected resolution output.
