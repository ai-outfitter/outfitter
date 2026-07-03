FROM oven/bun:1.3-debian AS deps

FROM node:22.19.0-bookworm

COPY --from=deps /usr/local/bin/bun /usr/local/bin/bun

ENV PATH="/opt/outfitter/node_modules/.bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/outfitter

COPY package.json bun.lock ./
COPY code/cli/package.json ./code/cli/package.json
COPY code/pi-extension/package.json ./code/pi-extension/package.json
RUN bun pm pkg delete scripts.prepare \
  && bun --cwd=code/cli pm pkg delete scripts.prepare \
  && bun install --frozen-lockfile

COPY code/cli/package.json code/cli/tsconfig.json code/cli/tsconfig.build.json ./code/cli/
COPY bin/outfitter-docker-entrypoint ./bin/outfitter-docker-entrypoint
COPY code/cli/skills ./code/cli/skills
COPY code/cli/src ./code/cli/src

RUN bun run build \
  && bun install --production \
  && ln -sf /opt/outfitter/code/cli/dist/cli.js /usr/local/bin/outfitter \
  && ln -sf /opt/outfitter/node_modules/.bin/pi /usr/local/bin/pi

RUN mkdir -p /home/node/.pi/agent /home/node/repos \
  && chown -R node:node /home/node/.pi /home/node/repos \
  && install -m 0755 ./bin/outfitter-docker-entrypoint /usr/local/bin/outfitter-docker-entrypoint

ENV HOME=/home/node
USER root
WORKDIR /home/node/repos

ENTRYPOINT ["outfitter-docker-entrypoint"]
