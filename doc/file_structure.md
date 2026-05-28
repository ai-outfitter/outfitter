# Bridl File Structure

This document records the key repository file and directory structure used by Bridl. See `doc/architecture.md` for runtime file conventions such as `.bridl` settings folders, profile folders, and generated tack directories.

## Repository Layout

Bridl is organized around clear TypeScript source boundaries, requirement documents, and scenario-based tests.

```text
.                                      # repository root
├── doc/                               # architecture, design, and specification docs
│   ├── architecture.md                # architectural rationale and runtime file conventions
│   ├── controllable-elements.md       # controllable element terminology and support matrix
│   ├── file_structure.md              # repository file structure overview
│   └── specs/                         # detailed supporting specs
├── requirements/                      # formal BRIDL requirement documents
│   ├── BRIDL-REQ-001-project-foundation.md
│   └── ...
├── plan.md                            # implementation plan
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
│   │   ├── ProfileLoader.ts
│   │   ├── ProfileMerger.ts
│   │   └── ProfileSource.ts
│   ├── tack/                          # generated runtime tack assembly and watching
│   │   ├── Tack.ts
│   │   ├── TackAssembler.ts
│   │   ├── TackFile.ts
│   │   └── TackWatcher.ts
│   ├── agents/                        # agent adapter boundary and CLI-specific adapters
│   │   ├── AgentAdapter.ts
│   │   └── pi/                        # pi-specific adapter implementation
│   │       ├── PiAdapter.ts
│   │       └── PiTackWriter.ts
│   ├── schemas/                       # JSON Schema artifacts for persisted formats
│   │   ├── settings.schema.json
│   │   ├── profile.schema.json
│   │   └── profile-source.schema.json
│   └── validation/                    # shared validation helpers
│       └── SchemaValidator.ts
├── tests/                             # automated tests
│   ├── fixtures/                      # reusable test fixtures
│   │   └── scenarios/                 # realistic .bridl scenarios and expected outputs
│   └── unit/                          # unit tests
└── package.json                       # npm package metadata and scripts
```

The exact layout may evolve, but these boundaries should stay recognizable.

## Test Scenario Fixtures

Scenario fixtures should live under `tests/fixtures/scenarios/`, for example:

```text
tests/fixtures/scenarios/
  user-default-only/
  project-overrides-user/
  project-local-overrides-project/
  uri-source-with-filter/
  profile-inheritance-chain/
  cli-specific-pi-overrides/
  unsupported-control-warning/
```

Each scenario should include realistic `.bridl` folders and expected resolution output.
