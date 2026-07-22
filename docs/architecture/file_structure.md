# Outfitter File Structure

This document records the key repository file and directory structure used by Outfitter.
See [`./README.md`](./README.md) for runtime file conventions such as `.agents` layers, settings files, and generated composition directories.

> **RFC [#165](https://github.com/ai-outfitter/outfitter/issues/165) status:** the profile-era `profiles/` and `compositeProfile/` modules have been removed; `code/cli/src` now uses the dotagents pipeline (`resolver/`, `composer/`, `projection/`, `dump/`, `sources/`). Interactive `.agents` onboarding is back as `setup/` (the `outfitter setup` command and the implicit first-run trigger from `run`); remote `sync` remains deferred to a follow-up PR.

## Repository Layout

Outfitter is organized around a private npm workspace root, clear TypeScript package boundaries, requirement documents, and scenario-based tests.

```text
.                                      # repository root
├── .deepreview                        # root DeepWork review rules for project-wide checks
├── .deepwork/                         # DeepWork schemas and generated review instruction scratch files
│   └── schemas/                       # project-specific DeepSchema definitions
├── .github/                           # GitHub automation configuration
│   └── workflows/                     # GitHub Actions workflows and local .deepreview rules
├── .outfitter/                        # Outfitter's own project configuration
│   └── skills/outfitter/              # bundled self-documentation skill published into launches
├── docs/                              # documentation, architecture, requirements, plans, and specs
│   ├── architecture/                  # architecture and internal design docs
│   ├── documentation/                 # user-facing Outfitter docs
│   ├── requirements/                  # formal OUTFITTER requirement documents
│   └── specs/                         # detailed supporting specs
├── .prettierignore                    # Prettier ignore rules
├── .prettierrc.json                   # Prettier formatting configuration
├── .snapperrc.toml                    # Snapper Markdown formatting configuration
├── CONTRIBUTING.md                    # local install and contributor workflow guide
├── flake.nix                          # Nix package and container outputs for the Outfitter CLI
├── flake.lock                         # pinned Nix flake inputs
├── code/                              # npm workspace packages and license-separated code areas
│   ├── cli/                           # @ai-outfitter/outfitter npm package root
│   │   ├── eslint.config.js           # CLI package ESLint configuration
│   │   ├── package.json               # published package metadata, bin, files, and package-local scripts
│   │   ├── scripts/                   # package-local helper scripts
│   │   │   ├── dev-install.mjs        # npm-link installer for local CLI development
│   │   │   └── sync-package-assets.mjs # prepack staging for root README/license, docs, the bundled skill, and enterprise notices
│   │   ├── src/                       # production TypeScript source
│   │   │   ├── cli.ts                 # executable CLI entry point
│   │   │   ├── cli/                   # CLI parser construction and command objects
│   │   │   │   └── commands/          # run, setup, list, validate, dump command objects
│   │   │   ├── settings/              # settings loading and merging
│   │   │   ├── setup/                 # onboarding state + pinned default-catalog bootstrap
│   │   │   ├── sources/               # remote `.agents` source cache paths and reference normalization
│   │   │   ├── resolver/              # .agents layer resolution into one effective resource set
│   │   │   ├── composer/              # harness-neutral CompositionPlan from the effective set
│   │   │   ├── projection/            # materialize a composition + build a pi/claude launch plan
│   │   │   ├── dump/                  # deterministic self-contained `.agents` tree output
│   │   │   ├── merge/                 # deterministic value and array merge policy helpers
│   │   │   ├── agents/                # AgentLaunch: bundled-pi resolution and process launch boundary
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

Within a resolved `.agents` layer, an agent may include a harness-native Pi configuration overlay:

```text
agents/<agent>/
├── agent.md
├── config.json             # optional harness-neutral loadout overrides
└── pi/                     # copied into the temporary PI_CODING_AGENT_DIR
    ├── settings.json
    ├── keybindings.json
    └── ...                 # other native Pi configuration files/directories
```

The resolver retains every contributing `pi/` directory in layer-precedence order. The Pi projection materializes them from lowest to highest precedence and skips symlinks; other harness projections do not consume them.

## Published Package Assets

The CLI package root is `code/cli`, but the npm package must still include repository-level notices. The CLI package `prepack` script runs `code/cli/scripts/sync-package-assets.mjs`, which stages `README.md`, `LICENSE.md`, `code/enterprise/LICENSE`, and `code/enterprise/README.md` inside `code/cli` before `npm pack` or `npm publish`.

## Test Fixtures

Integration fixtures should live under `code/cli/tests/fixtures/integration/` with full `home/`, `project/`, and optional `expected/` trees.
Fixture-backed integration tests and shared harness helpers should live under `code/cli/tests/integration/`.

Scenario fixtures should live under `code/cli/tests/fixtures/scenarios/`, for example:

```text
code/cli/tests/fixtures/scenarios/
  profile-cycle/
  profile-inheritance-chain/
  profile-missing-inheritance/
  profile-multiple-inheritance/
  profile-precedence/
```

The `profile-*` scenarios above are the current profile-era fixtures; per the transition note, the implementation PRs that add the resolver and composition modules replace them with target-state scenarios whose fixtures include realistic `.agents` trees and expected resolution output. Protocol conformance fixtures (layered trees plus expected effective output, pinned to the protocol revision) follow the same convention.
