FROM node:22.19.0-bookworm

ENV PATH="/opt/outfitter/node_modules/.bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git openssh-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/outfitter

COPY package.json package-lock.json ./
RUN npm pkg delete scripts.prepare \
  && npm ci

COPY package.json tsconfig.json tsconfig.build.json ./
COPY bin/outfitter-docker-entrypoint ./bin/outfitter-docker-entrypoint
COPY skills ./skills
COPY src ./src

RUN npm run build \
  && npm prune --omit=dev \
  && ln -sf /opt/outfitter/dist/cli.js /usr/local/bin/outfitter \
  && ln -sf /opt/outfitter/node_modules/.bin/pi /usr/local/bin/pi

RUN mkdir -p /home/node/.pi/agent /home/node/repos \
  && chown -R node:node /home/node/.pi /home/node/repos \
  && install -m 0755 ./bin/outfitter-docker-entrypoint /usr/local/bin/outfitter-docker-entrypoint

ENV HOME=/home/node
USER root
WORKDIR /home/node/repos

ENTRYPOINT ["outfitter-docker-entrypoint"]
