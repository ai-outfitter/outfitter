# OFTR-009: Release Publishing

## Overview

Outfitter release publishing prepares package metadata from a GitHub release tag and publishes the `@ai-outfitter/outfitter` npm package through GitHub Actions.

## Requirements

### OFTR-009.1: Release Metadata Synchronization

1. The release metadata synchronization script MUST accept a release version from an explicit argument, `OUTFITTER_RELEASE_VERSION`, or `GITHUB_REF_NAME`, in that precedence order.
2. The release metadata synchronization script MUST normalize a leading `v` from release tags before writing package metadata.
3. The release metadata synchronization script MUST reject invalid Semantic Versioning values before mutating package metadata.
4. The release metadata synchronization script MUST update the root `package.json` version, root `package-lock.json` version, and `package-lock.json` root package entry version to the same normalized release version.
5. The release metadata synchronization script MUST verify that the root package metadata it prepares belongs to the `@ai-outfitter/outfitter` npm package.
6. The release metadata synchronization script MUST fail with an actionable error when required package-lock root package metadata is missing.

### OFTR-009.2: Npm Release Workflow

1. The npm release workflow MUST run when a GitHub release is published.
2. The npm release workflow MUST install dependencies with `npm ci` before publishing.
3. The npm release workflow MUST synchronize package metadata from the GitHub release tag before publishing.
4. The npm release workflow MUST run CI checks before publishing.
5. The npm release workflow MUST build the package before publishing.
6. The npm release workflow MUST publish the public `@ai-outfitter/outfitter` package to the npm registry using an npm token secret.
