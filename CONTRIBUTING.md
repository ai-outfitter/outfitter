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

## Release publishing

Outfitter uses Release Please for release PRs and npm trusted publishing for package publishing.

Release flow:

1. Land changes on `main` using Conventional Commits.
2. Release Please opens or updates a release PR.
3. A maintainer reviews and merges the release PR when ready.
4. Release Please creates the `vX.Y.Z` GitHub release.
5. The release workflow publishes `@ai-outfitter/outfitter` to npm through trusted publishing / OIDC.

Conventional Commit bump mapping: `fix:` creates a patch release, `feat:` creates a minor release, and a breaking-change marker (`!` or `BREAKING CHANGE:` footer) creates a major release.

Human setup required:

- Configure the organization Actions secret `RELEASE_PLEASE_TOKEN` under `ai-outfitter`, scoped to selected repositories. Add `outfitter` now and add future npm-published repositories as they adopt this workflow. The token needs contents, pull-request, and issue write access for Release Please.
- Configure npm trusted publishing for `@ai-outfitter/outfitter` with owner `ai-outfitter`, repository `outfitter`, workflow file `release.yml`, and environment `npm-publish`.
- Create the GitHub environment `npm-publish` in each publishing repository that uses that environment. The environment is repository-scoped even when the Release Please token is organization-scoped.
- Do not configure `NPM_TOKEN`; the release workflow publishes with OIDC and does not set `NODE_AUTH_TOKEN`.

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
