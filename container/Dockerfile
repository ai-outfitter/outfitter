# syntax=docker/dockerfile:1
# Outfitter primary published image (ghcr.io/ai-outfitter/outfitter).
#
# Debian-based on purpose. The previous image was a Nix closure. End users
# could not extend it conventionally — no apt, no /lib64 ELF interpreter for
# foreign dynamic binaries, node/npm not on PATH (extension installs died with
# `spawn npm ENOENT`), and the CA bundle at a non-default path. This image
# makes the end-user story a plain Dockerfile: `FROM` this image, `apt-get
# install` or `COPY` whatever the agent needs.
#
# Build dependencies are cached separately from source changes.
ARG NODE_IMAGE=node:24-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /build
COPY package.json package-lock.json ./
COPY code/cli/package.json code/cli/package.json
COPY code/pi-extension/package.json code/pi-extension/package.json
RUN npm ci --ignore-scripts
COPY . .
ARG RELEASE_VERSION=
RUN if [ -n "$RELEASE_VERSION" ]; then node scripts/sync-release-version.mjs "$RELEASE_VERSION"; fi \
  && mkdir /package \
  && npm pack --workspace @ai-outfitter/outfitter --pack-destination /package \
  && mv /package/*.tgz /package/outfitter.tgz

FROM ${NODE_IMAGE}
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    openssh-client \
  && rm -rf /var/lib/apt/lists/*

# Bind-mount the tarball instead of COPYing it, so it never lands in a layer.
RUN --mount=type=bind,from=build,source=/package/outfitter.tgz,target=/tmp/outfitter.tgz \
  npm install -g /tmp/outfitter.tgz \
  && npm cache clean --force

# The runtime contract is uid/gid 1000 (the operator runs runAsUser: 1000,
# fsGroup: 1000); only the uid matters to workloads. node:24-slim already
# ships uid 1000 as `node` — rename it to `outfitter` and point its home at
# /tmp so /etc/passwd agrees with the HOME below.
RUN usermod -l outfitter -d /tmp node \
  && groupmod -n outfitter node \
  && mkdir -p /workspace \
  && chown 1000:1000 /workspace

# Deployments override HOME (e.g. HOME=/workspace onto a persistent volume);
# /tmp is the writable default when they do not.
ENV HOME=/tmp

USER 1000:1000
WORKDIR /workspace

# No init shim and no CMD: outfitter >=1.4.0 forwards SIGTERM/SIGINT/SIGHUP
# to its child itself (code/cli/src/agents/AgentLaunch.ts,
# attachSignalForwarding), so PID 1 duty needs no tini.
ENTRYPOINT ["outfitter"]
