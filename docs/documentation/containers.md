# Container images

The published image is a generic Outfitter runtime:

```text
ghcr.io/ai-outfitter/outfitter:<version>
```

It uses `outfitter` as its entrypoint and includes the Nix CLI, Bash, core
utilities, Git, SSH, and CA certificates. It does not include agent profiles,
credentials, channels, MCP servers, or other use-case behavior. The default
runtime user and group are both `1000`, with `/tmp` as the home directory.

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

Being built with Nix does not normally imply that an image contains the Nix
CLI. The published Outfitter image includes it intentionally, and the flake also
exports `lib.mkContainer` for reproducible derivative images:

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    outfitter = {
      url = "github:ai-outfitter/outfitter/v1.2.0";
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

**Do not mount an empty volume over `/nix`.** The image _is_ its Nix store: the
entrypoint is an absolute store path and every binary in `/bin` is a symlink
into `/nix/store`. Mounting a fresh volume there hides all of it, so the
container cannot start — it fails before it could initialize the very store you
mounted the volume to populate.

Runtime installation therefore needs one of:

- a volume **pre-populated** with the image's closure, seeded from the image
  before the agent starts (an init container copying `/nix` into the volume);
- an **overlay** whose lower layer is the image's `/nix`, so the closure stays
  visible while writes land in the upper layer; or
- writable Nix **state** only — `/nix/var` and a per-user profile — leaving the
  store itself as the image shipped it.
