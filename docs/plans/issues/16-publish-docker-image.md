---
title: Build and publish the Docker image from CI
labels: [enhancement, m2-hardening, plan-2026-07]
size: M
---

## Problem

The Dockerfile (node:22, bundles outfitter + pi) and its UID-remapping entrypoint are written and unit-tested (`tests/unit/container-entrypoint.test.ts`), but no workflow builds or publishes the image. Container-image publishing was dropped from the release path (CONTRIBUTING). Users who want a containerized/sandboxed agent loadout — a natural fit for the product story — have to build it themselves.

## Scope

- GitHub Actions job: build and push to GHCR on release (tags aligned with release-please versions + `latest`); multi-arch (amd64/arm64) if build time is acceptable.
- Smoke the image in CI: `docker run … outfitter --version` and entrypoint UID remap.
- README section: running Outfitter via Docker.

## Acceptance criteria

- `docker run ghcr.io/ai-outfitter/outfitter` reaches onboarding.
- Image published automatically on each release.

## References

- `Dockerfile`, `bin/outfitter-docker-entrypoint`
- `code/cli/tests/unit/container-entrypoint.test.ts`
- `.github/workflows/release.yml`
