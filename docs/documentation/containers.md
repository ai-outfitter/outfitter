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

A Nix closure variant of the image is also published under the `-nix` suffix;
see [the `-nix` variant](#the--nix-variant) below.

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
          # The primary Debian-based image; append -nix for the Nix variant.
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
tools expect it (unlike the `-nix` variant), but the slim base ships a small
library set: `apt-get install` a binary's runtime libraries when it needs more.
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

## The `-nix` variant

The Nix closure image that was previously the primary tag remains published
for `lib.mkContainer` consumers:

```text
ghcr.io/ai-outfitter/outfitter:<version>-nix
```

It is built by the flake, includes the Nix CLI, Bash, core utilities, Git,
SSH, and CA certificates, and its entrypoint is an absolute `/nix/store` path.
It is not conventionally extensible — there is no apt, and foreign dynamic
binaries do not run — so extend it through Nix instead: the flake exports
`lib.mkContainer` for reproducible derivative images:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    outfitter = {
      url = "github:ai-outfitter/outfitter/v1.4.0";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, outfitter, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
    in
    {
      packages.${system}.default = outfitter.lib.mkContainer {
        inherit pkgs;
        outfitterPackage = outfitter.packages.${system}.outfitter;
        name = "example-agent";
        extraPackages = [
          pkgs.jq
          pkgs.ripgrep
        ];
      };
    };
}
```

Build and exercise the exact image:

```sh
nix build
docker load < result
docker run --rm example-agent:latest --version
docker run --rm --entrypoint /bin/sh example-agent:latest \
  -c 'nix --version && jq --version && rg --version'
```

Prefer adding known runtime packages through `extraPackages`. The resulting
image stays reproducible, and it avoids the trap below.

**Do not mount an empty volume over `/nix` of the `-nix` variant.** That image
_is_ its Nix store: the entrypoint is an absolute store path and every binary
in `/bin` is a symlink into `/nix/store`. Mounting a fresh volume there hides
all of it, so the container cannot start — it fails before it could initialize
the very store you mounted the volume to populate. (The primary Debian image
has no `/nix` and is not affected.)

Runtime installation in the `-nix` variant therefore needs one of:

- a volume **pre-populated** with the image's closure, seeded from the image
  before the agent starts (an init container copying `/nix` into the volume);
- an **overlay** whose lower layer is the image's `/nix`, so the closure stays
  visible while writes land in the upper layer; or
- writable Nix **state** only — `/nix/var` and a per-user profile — leaving the
  store itself as the image shipped it.
