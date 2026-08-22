# OFTR-009: Release Publishing

## Overview

Outfitter release publishing prepares package metadata from Conventional Commit release PRs and GitHub release tags. It publishes the `@ai-outfitter/outfitter` CLI workspace package through npm trusted publishing and OIDC. It publishes a Debian-based container image through GitHub Container Registry.

## Requirements

### OFTR-009.1: Release Metadata Synchronization

1. The release metadata synchronization script MUST accept a release version from an explicit argument, `OUTFITTER_RELEASE_VERSION`, or `GITHUB_REF_NAME`, in that precedence order.
2. The release metadata synchronization script MUST normalize a leading `v` from release tags before writing package metadata.
3. The release metadata synchronization script MUST reject invalid Semantic Versioning values before mutating package metadata.
4. The release metadata synchronization script MUST update the root `package.json` version, CLI workspace `package.json` version, root `package-lock.json` version, package-lock root entry version, and package-lock CLI workspace entry version to the same normalized release version.
5. The release metadata synchronization script MUST verify that the package metadata it prepares for publishing belongs to the `@ai-outfitter/outfitter` npm package.
6. The release metadata synchronization script MUST verify that published package metadata declares `repository.url` as `https://github.com/ai-outfitter/outfitter.git` so npm provenance validation can match the publishing repository.
7. The release metadata synchronization script MUST fail with an actionable error when required package-lock root or CLI workspace package metadata is missing.

### OFTR-009.2: Npm Release Workflow

1. The npm release workflow MUST run when a GitHub release is published.
2. The npm release workflow MUST install dependencies with `npm ci` before publishing.
3. The npm release workflow MUST synchronize package metadata from the GitHub release tag before publishing.
4. The npm release workflow MUST run CI checks before publishing.
5. The npm release workflow MUST build the package before publishing.
6. The npm release workflow MUST request `id-token: write`, use the `npm-publish` GitHub environment, and publish the public `@ai-outfitter/outfitter` package to the npm registry with provenance through npm trusted publishing / OIDC rather than `NPM_TOKEN` or `NODE_AUTH_TOKEN`.

### OFTR-009.3: Conventional Commit Release Automation

1. The Release Please workflow MUST run on pushes to `main`.
2. The Release Please workflow MUST use `googleapis/release-please-action@v4` with the upstream example-style token input from `secrets.RELEASE_PLEASE_TOKEN`.
3. The Release Please workflow MUST use manifest configuration files to release the `code/cli` workspace as the `@ai-outfitter/outfitter` node package.
4. The Release Please workflow MUST derive version bumps from Conventional Commits.
5. The Release Please workflow MUST update npm package metadata and changelog through a release PR before publishing.
6. The Release Please workflow MUST use GitHub repository write auth capable of triggering release PR CI and the release-published npm workflow, not the default `GITHUB_TOKEN`.

### OFTR-009.4: Container Image Runtime

1. The primary published container image MUST be Debian-based so end users can extend it with a conventional Dockerfile (`apt-get install`, `COPY` of dynamically linked binaries).
2. The primary image MUST install Outfitter from the CLI workspace tarball built in the release workflow, not from the npm registry, so the image is buildable for unreleased versions and in CI before publish.
3. The primary image MUST include Node.js matching the `.node-version` major, npm, Git, SSH, and CA certificates at their conventional Debian paths, and MUST use `outfitter` as its entrypoint.
4. The primary image MUST run as UID/GID 1000 with `/workspace` as its working directory and `/tmp` as its default home directory.
5. The release workflow MUST smoke test the image before publishing it. The test MUST check `outfitter --version`, Node.js, npm, Git, SSH, and the CA bundle at `/etc/ssl/certs/ca-certificates.crt`.
6. The release workflow MUST smoke test a derivative build of the image. The build MUST install a package with `apt-get` as root. The build MUST return to UID 1000.
7. Documentation MUST define the persistent Kubernetes invocation and conventional Dockerfile extension. It MUST explain that callers own profile configuration, credentials, and channel-specific extensions.
