# Container images

The published image is a generic Outfitter runtime:

```text
ghcr.io/ai-outfitter/outfitter:<version>
```

It is Debian-based (`node:24-slim`), uses `outfitter` as its entrypoint, and
includes Node.js, npm, Git, SSH, and CA certificates at their conventional
Debian paths. It does not include agent profiles, credentials, channels, MCP
servers, or other use-case behavior. The default runtime user and group are
both `1000` (named `outfitter`), with `/tmp` as the home directory and
`/workspace` as the working directory.

## Run a resident agent

A resident container is an ordinary `outfitter run` whose harness stays in RPC
mode. Keep standard input open so the harness remains available while its
extensions wait for work:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-agent
spec:
  replicas: 1
  selector:
    matchLabels:
      app: example-agent
  template:
    metadata:
      labels:
        app: example-agent
    spec:
      securityContext:
        # Pod-level, and not optional. HOME points at the mounted volume, and a
        # freshly provisioned volume arrives owned by root — runAsUser does not
        # change that. Extension installs and credential persistence both write
        # below HOME, so without fsGroup the agent fails with EACCES on first
        # write rather than at startup. A volume plugin that ignores fsGroup
        # must be pre-provisioned with UID/GID 1000 ownership instead.
        fsGroup: 1000
      containers:
        - name: agent
          # The published Debian-based image.
          image: ghcr.io/ai-outfitter/outfitter:<version>
          stdin: true
          workingDir: /workspace
          securityContext:
            runAsNonRoot: true
            runAsUser: 1000
            runAsGroup: 1000
          env:
            - name: HOME
              value: /workspace
          args:
            - run
            - example-agent
            - --strict
            - --
            - --mode
            - rpc
            - --no-session
          volumeMounts:
            - name: workspace
              mountPath: /workspace
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: example-agent
```

Mount `.agents` settings, credentials, and any channel configuration through
the workload that owns the container. The image does not interpret Kubernetes
resources or impose image, profile, or extension policy.

## Build a derivative image

The image is a normal Debian base: extend it with an ordinary Dockerfile.
`apt-get` works, and so does `COPY`ing binaries. A dynamically linked binary
runs when it matches the image — same architecture, glibc-linked, and its
shared-library dependencies present. The standard ELF interpreter is where
tools expect it, but the slim base ships a small library set. Use `apt-get
install` when a binary needs more runtime libraries.
Switch to `root` for the layers that install, then drop back to `1000`:

```dockerfile
FROM ghcr.io/ai-outfitter/outfitter:<version>

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends jq ripgrep \
  && rm -rf /var/lib/apt/lists/*
COPY --chmod=0755 my-tool /usr/local/bin/my-tool
USER 1000
```

Build and exercise the exact image:

```sh
docker build -t example-agent .
docker run --rm example-agent --version
docker run --rm --entrypoint /bin/sh example-agent \
  -c 'jq --version && rg --version && my-tool --version'
```

The entrypoint stays `outfitter`; override `ENTRYPOINT` only when the derived
image wraps the launch itself.
