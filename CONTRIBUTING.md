# Contributor Guide

This guide describes how to install and test Outfitter locally from a source checkout.
For normal usage, install Outfitter from npm with `npm install -g @ai-outfitter/outfitter`.

## Prerequisites

- Node.js `24.18.0`, as pinned in `.node-version`
- npm, using the committed `package-lock.json`
- Git
- Optional for end-to-end `outfitter run` testing: the `pi` CLI available on your `PATH`

`.node-version` is the canonical Node.js version for local development and GitHub Actions. Each project-owned `package.json#engines.node` field declares the compatible major-version range for package consumers, and the Nix package uses the matching Node.js major version; update them together when changing Node.js versions.

## Repository structure

| Path                                            | Use it for                                               |
| ----------------------------------------------- | -------------------------------------------------------- |
| [Documentation](./docs/documentation/README.md) | User-facing setup, composition, and catalog docs.        |
| [Architecture](./docs/architecture/README.md)   | Architecture, runtime design, and internal conventions.  |
| [Requirements](./docs/requirements/)            | Formal OFTR requirements.                                |
| [CLI package](./code/cli/)                      | Published CLI package source, tests, skills, and config. |
| [Pi extension](./code/pi-extension/)            | Future Pi extension package boundary.                    |
| [Changelog](./CHANGELOG.md)                     | Release history.                                         |
| [License](./LICENSE.md)                         | License terms.                                           |

## Install dependencies

From the repository root:

```sh
npm install
```

## Install a local `outfitter` command

Use the development installer from the repository root:

```sh
npm run dev_install
```

This script:

1. Builds the CLI workspace into `code/cli/dist/`.
2. Runs `npm link` so the global `outfitter` package points at `code/cli`.
3. Verifies the global package symlink resolves to this checkout.
4. Smoke-tests `outfitter --version` and `outfitter --help` through the global bin.

Because the global package is linked to the CLI workspace, rebuilding `code/cli/dist/` updates the installed command:

```sh
npm run build
outfitter --help
```

To remove the linked command later:

```sh
npm unlink -g outfitter
```

## Smoke-test with an isolated home directory

Use a temporary `HOME` so setup and profile files do not affect your real user config:

```sh
export OUTFITTER_TEST_HOME="$(mktemp -d)"
HOME="$OUTFITTER_TEST_HOME" outfitter setup
HOME="$OUTFITTER_TEST_HOME" outfitter profile create smoke
```

You can inspect the generated user config at:

```sh
find "$OUTFITTER_TEST_HOME/.outfitter" -maxdepth 4 -type f -print
```

For source-checkout smoke tests, prefer the helper scripts in `bin/` so agents and humans exercise the current worktree instead of an older global install.

### Install this checkout as `outfitter-dev`

Use `bin/dev-install-outfitter-dev` when you want a stable global command that points at this checkout without replacing the normal `outfitter` command:

```sh
bin/dev-install-outfitter-dev --force
outfitter-dev --version
outfitter-dev --help
```

After source changes, rerun the script or `npm run build` so `dist/` reflects the worktree.

### Run an isolated first-run/setup smoke test

Use `bin/dev-tmp-home` to build the current checkout, create a temporary `HOME`, copy existing Pi auth into that temporary home if present, run first-run setup with the built-in default profile source, and remove the temporary home on exit:

```sh
bin/dev-tmp-home
```

This is the safest local smoke test for onboarding and setup changes because it does not write to your real `~/.outfitter` state.

### Run setup against a specific source

Use `bin/dev-setup-source` when you intentionally want to preserve the caller's `HOME` and current working directory while running this checkout's build against a real setup source:

```sh
bin/dev-setup-source /path/to/setup-source
bin/dev-setup-source https://github.com/ai-outfitter/default-profiles
```

Because this command writes to the active home or project target, use it only when that mutation is intended.

### Run the local container smoke test

Use `bin/dev-container-setup` to build the local development image and run Outfitter in a container. Pi credentials and settings are stored in the named container volume `outfitter-pi-agent`, not copied from the host:

```sh
bin/dev-container-setup
bin/dev-container-setup https://github.com/ai-outfitter/default-profiles
bin/dev-container-setup ../outfitter-default-profiles
```

Pass `--skip-build` to reuse an existing `outfitter-dev:local` image:

```sh
bin/dev-container-setup --skip-build
```

## Try the run command

If `pi` is installed, create or edit a profile under the isolated home and run it:

```sh
HOME="$OUTFITTER_TEST_HOME" outfitter run --profile default -- --help
```

Outfitter assembles a temporary composite profile under the system temp directory, sets `PI_CODING_AGENT_DIR` for pi, and passes arguments after the profile options through to pi.

## Docker

Each published release builds the `container` output from `flake.nix` and pushes a `linux/amd64` image to GitHub Container Registry as `ghcr.io/ai-outfitter/outfitter:<version>` and `ghcr.io/ai-outfitter/outfitter:latest` (see the `publish-docker` job in `.github/workflows/release.yml`).
The minimal image bundles the Nix-built Outfitter package and uses `outfitter` directly as its entrypoint.
Use the manually dispatched `Container` workflow to reproduce and smoke test a release image without publishing it. Its Nix store paths are cached between GitHub Actions runs; the normal pull-request and push CI workflow does not build the image.

Run the published image:

```sh
docker run --rm -it ghcr.io/ai-outfitter/outfitter
```

## Test profiles with a local container

The release workflow publishes the npm package from the `code/cli` workspace and the container image to GHCR.
The flake container output is also useful for local smoke testing on Linux.

Build a local image from the repository root:

```sh
nix build .#container
docker load < result
docker tag outfitter:latest outfitter:dev
```

Run setup from a remote setup source:

```sh
docker run --rm -it \
  --mount type=volume,source=outfitter-pi-agent,target=/tmp/.pi/agent \
  -w /workspace \
  outfitter:dev \
  setup https://github.com/ai-outfitter/default-profiles
```

Run setup from a local profile source checkout:

```sh
docker run --rm -it \
  --mount type=volume,source=outfitter-pi-agent,target=/tmp/.pi/agent \
  -v "$PWD:/workspace/setup-source:ro" \
  -w /workspace \
  outfitter:dev \
  setup /workspace/setup-source
```

The named `outfitter-pi-agent` volume stores container-only Pi credentials and settings under `/tmp/.pi/agent`.
The container starts in `/workspace`; without extra mounts, each run gets a clean working directory.

## Validate changes before opening or updating a PR

Run formatting from the repository root.
The CI formatting gate is `prettier --check .`; package-local checks from `code/cli` and touched-file-only Prettier runs are not equivalent because this repository also includes root scripts, docs, and `code/enterprise`.

Use the mutating local check when formatting or lint auto-fixes may be needed:

```sh
npm run check
```

To check formatting without changing files, run this from the repository root:

```sh
npx prettier --check .
```

Use the CI-equivalent non-mutating check before final review:

```sh
npm run check-ci
```

Both commands run the coverage suite.
Coverage thresholds are intentionally set to 100% for statements, branches, functions, and lines.
Coverage includes all `code/cli/src/**/*.ts` files through the CLI workspace Vitest configuration, so new source files need tests even if they are only scaffolding.

## Commit and release workflow

Use Conventional Commits for every commit and PR title that will be squash-merged.
Supported types are `feat`, `fix`, `chore`, and `refactor`.
Each commit should represent one logical change.

Release automation is split across two workflows:

1. `.github/workflows/release-please.yml` runs on pushes to `main`.
   It uses `googleapis/release-please-action` to open or update a release PR when releasable Conventional Commits are present.
2. Merge the release-please PR to publish the GitHub release and tag.
3. `.github/workflows/release.yml` runs when that GitHub release is published.
   It publishes the CLI npm package from the `code/cli` workspace with trusted publishing and provenance.

`feat` commits normally create a minor release, and `fix` commits normally create a patch release.
Maintenance-only `chore` and `refactor` commits do not create a release by themselves.
If a change must produce a release, use a releasable Conventional Commit type that accurately describes the user-facing impact.
