# Contributor Guide

This guide describes how to install and test Outfitter locally from a source checkout.
For normal usage, install Outfitter from npm with `npm install -g @ai-outfitter/outfitter`.

## Prerequisites

- Node.js `>=22.19.0`
- npm, using the committed `package-lock.json`
- Git
- Optional for end-to-end `outfitter run` testing: the `pi` CLI available on your `PATH`

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

1. Builds the current checkout into `dist/`.
2. Runs `npm link` so the global `outfitter` package points at this working tree.
3. Verifies the global package symlink resolves to this checkout.
4. Smoke-tests `outfitter --version` and `outfitter --help` through the global bin.

Because the global package is linked to this checkout, rebuilding `dist/` updates the installed command:

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

## Try the run command

If `pi` is installed, create or edit a profile under the isolated home and run it:

```sh
HOME="$OUTFITTER_TEST_HOME" outfitter run --profile default -- --help
```

Outfitter assembles a temporary composite profile under the system temp directory, sets `PI_CODING_AGENT_DIR` for pi, and passes arguments after the profile options through to pi.

## Validate changes before opening or updating a PR

Use the mutating local check when formatting or lint auto-fixes may be needed:

```sh
npm run check
```

Use the CI-equivalent non-mutating check before final review:

```sh
npm run check-ci
```

Both commands run the coverage suite.
Coverage thresholds are intentionally set to 100% for statements, branches, functions, and lines.
