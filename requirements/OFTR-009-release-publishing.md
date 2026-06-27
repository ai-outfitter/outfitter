# OFTR-009: Release Publishing

## Overview

Outfitter release publishing prepares package metadata from Conventional Commit release PRs and GitHub release tags, then publishes the `@ai-outfitter/outfitter` npm package through GitHub Actions using npm trusted publishing / OIDC. It also prepares the release container image so host-mounted Outfitter and Pi state remains writable without leaving root-owned files on conventional Docker hosts.

## Requirements

### OFTR-009.1: Release Metadata Synchronization

1. The release metadata synchronization script MUST accept a release version from an explicit argument, `OUTFITTER_RELEASE_VERSION`, or `GITHUB_REF_NAME`, in that precedence order.
2. The release metadata synchronization script MUST normalize a leading `v` from release tags before writing package metadata.
3. The release metadata synchronization script MUST reject invalid Semantic Versioning values before mutating package metadata.
4. The release metadata synchronization script MUST update the root `package.json` version, root `package-lock.json` version, and `package-lock.json` root package entry version to the same normalized release version.
5. The release metadata synchronization script MUST verify that the root package metadata it prepares belongs to the `@ai-outfitter/outfitter` npm package.
6. The release metadata synchronization script MUST verify that `package.json` and the package-lock root metadata declare `repository.url` as `https://github.com/ai-outfitter/outfitter.git` so npm provenance validation can match the publishing repository.
7. The release metadata synchronization script MUST fail with an actionable error when required package-lock root package metadata is missing.

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
3. The Release Please workflow MUST use `release-type: node` for the root `@ai-outfitter/outfitter` npm package.
4. The Release Please workflow MUST derive version bumps from Conventional Commits.
5. The Release Please workflow MUST update npm package metadata and changelog through a release PR before publishing.
6. The Release Please workflow MUST use GitHub repository write auth capable of triggering release PR CI and the release-published npm workflow, not the default `GITHUB_TOKEN`.

### OFTR-009.4: Container Image Runtime

1. The release container entrypoint MUST run Outfitter with `HOME=/home/node` unless the caller supplies another home directory.
2. When the container starts as a non-root user, the entrypoint MUST execute Outfitter directly without changing the caller-selected identity.
3. When the container starts as root and the working directory is owned by a non-root UID/GID, the entrypoint MUST drop to that UID/GID before executing Outfitter so rootful Docker bind mounts do not receive root-owned files.
4. When the container starts as root and the working directory is owned by UID `0`, the entrypoint MUST execute Outfitter as root so rootless Podman bind mounts, which expose the host user as container root by default, remain writable.
