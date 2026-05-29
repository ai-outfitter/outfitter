# Contributor Guide

This guide describes how to install and test Bridl locally from a checkout.

## Prerequisites

- Node.js `>=22.19.0`
- npm, using the committed `package-lock.json`
- Git
- Optional for end-to-end `bridl run` testing: the `pi` CLI available on your `PATH`

## Install dependencies

From the repository root:

```sh
npm install
```

## Install a local `bridl` command

Use the development installer from the repository root:

```sh
npm run dev_install
```

This script:

1. Builds the current checkout into `dist/`.
2. Runs `npm link` so the global `bridl` package points at this working tree.
3. Verifies the global package symlink resolves to this checkout.
4. Smoke-tests `bridl --version` and `bridl --help` through the global bin.

Because the global package is linked to this checkout, rebuilding `dist/` updates the installed command:

```sh
npm run build
bridl --help
```

To remove the linked command later:

```sh
npm unlink -g bridl
```

## Smoke-test with an isolated home directory

Use a temporary `HOME` so setup and profile files do not affect your real user config:

```sh
export BRIDL_TEST_HOME="$(mktemp -d)"
HOME="$BRIDL_TEST_HOME" bridl setup
HOME="$BRIDL_TEST_HOME" bridl create-profile smoke
```

You can inspect the generated user config at:

```sh
find "$BRIDL_TEST_HOME/.bridl" -maxdepth 4 -type f -print
```

## Try the run command

If `pi` is installed, create or edit a profile under the isolated home and run it:

```sh
HOME="$BRIDL_TEST_HOME" bridl run --profile default -- --help
```

Bridl assembles a temporary tack under the system temp directory, sets `PI_CODING_AGENT_DIR` for pi, and passes arguments after the profile options through to pi.

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
