{
  description = "Outfitter — reproducible configuration for agent CLIs";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;
      mkContainer =
        {
          pkgs,
          outfitterPackage,
          extraPackages ? [ ],
          name ? "outfitter",
          tag ? "latest",
        }:
        let
          runtime = pkgs.buildEnv {
            name = "${name}-container-runtime";
            paths = [
              outfitterPackage
              pkgs.nix
              pkgs.bashInteractive
              pkgs.coreutils
              pkgs.gnutar
              pkgs.gzip
              pkgs.cacert
              pkgs.gitMinimal
              pkgs.nodejs_24
              pkgs.openssh
              pkgs.dockerTools.binSh
              pkgs.dockerTools.usrBinEnv
            ] ++ extraPackages;
            pathsToLink = [
              "/bin"
              "/etc"
              "/usr/bin"
            ];
            ignoreCollisions = true;
          };
        in
        pkgs.dockerTools.buildLayeredImage {
          inherit name tag;
          contents = [ runtime ];
          extraCommands = ''
            mkdir -p etc tmp workspace
            # root must exist even though nothing here runs as root. A derived
            # image does `USER root` to COPY and chmod its own entrypoint, and
            # the builder resolves that name against this passwd file — without
            # an entry, every downstream RUN fails with "unknown user error
            # looking up user root" before the layer even executes, which makes
            # the image unusable as the base this exists to be.
            printf 'root:x:0:0:root:/root:/bin/bash\n' > etc/passwd
            printf 'outfitter:x:1000:1000:Outfitter:/tmp:/bin/bash\n' >> etc/passwd
            printf 'nobody:x:65534:65534:nobody:/var/empty:/bin/false\n' >> etc/passwd
            printf 'root:x:0:\n' > etc/group
            printf 'outfitter:x:1000:\n' >> etc/group
            printf 'nogroup:x:65534:\n' >> etc/group
            chmod 1777 tmp workspace
          '';
          config = {
            Entrypoint = [ "${outfitterPackage}/bin/outfitter" ];
            Env = [
              "HOME=/tmp"
              "PATH=/bin:/usr/bin"
              "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
              "NIX_SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
              "NIX_CONFIG=experimental-features = nix-command flakes"
            ];
            User = "1000:1000";
            WorkingDir = "/workspace";
          };
        };
    in
    {
      lib = { inherit mkContainer; };

      packages = forAllSystems (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          package = builtins.fromJSON (builtins.readFile ./code/cli/package.json);
          packageLock = builtins.fromJSON (builtins.readFile ./package-lock.json);
          piCodingAgentPath = "node_modules/@earendil-works/pi-coding-agent";
          piCodingAgent = packageLock.packages.${piCodingAgentPath};
          piCodingAgentSource = pkgs.fetchurl {
            url = piCodingAgent.resolved;
            hash = piCodingAgent.integrity;
          };
          piCodingAgentWithoutShrinkwrap =
            pkgs.runCommand "pi-coding-agent-${piCodingAgent.version}.tgz" { }
              ''
                mkdir package-source
                tar -xzf ${piCodingAgentSource} -C package-source
                rm package-source/package/npm-shrinkwrap.json
                tar -C package-source -cf - package | gzip -n > "$out"
              '';
          nixPackageLock = packageLock // {
            packages = packageLock.packages // {
              ${piCodingAgentPath} = builtins.removeAttrs piCodingAgent [
                "hasShrinkwrap"
                "integrity"
              ];
            };
          };
        in
        rec {
          outfitter = pkgs.buildNpmPackage {
            pname = "outfitter";
            inherit (package) version;
            nodejs = pkgs.nodejs_24;

            src = ./.;
            # The bundled pi package ships an npm-shrinkwrap whose registry URLs bypass
            # importNpmLock. Remove it from the fetched tarball so the root lockfile's
            # integrity-pinned dependency graph remains authoritative and offline.
            npmDeps = pkgs.importNpmLock {
              npmRoot = ./.;
              packageLock = nixPackageLock;
              packageSourceOverrides.${piCodingAgentPath} = piCodingAgentWithoutShrinkwrap;
            };
            npmConfigHook = pkgs.importNpmLock.npmConfigHook;
            npmWorkspace = "code/cli";

            nativeBuildInputs = [ pkgs.makeWrapper ];

            installPhase = ''
              runHook preInstall

              package_out="$out/lib/node_modules/${package.name}"
              while IFS= read -r file; do
                destination="$package_out/$(dirname "$file")"
                mkdir -p "$destination"
                cp "code/cli/$file" "$destination"
              done < <(
                ${pkgs.jq}/bin/jq --raw-output \
                  '.[0].files | map(.path) | join("\n")' \
                  <<< "$(npm pack --json --dry-run --loglevel=warn --no-foreground-scripts --workspace=code/cli)"
              )

              npm prune --omit=dev --no-save --ignore-scripts
              rm -rf node_modules/@ai-outfitter
              rm -f node_modules/.bin/outfitter
              cp -r node_modules "$package_out/node_modules"

              makeWrapper ${pkgs.nodejs_24}/bin/node "$out/bin/outfitter" \
                --add-flags "$package_out/${package.bin.outfitter}" \
                --prefix PATH : ${
                  nixpkgs.lib.makeBinPath [
                    pkgs.git
                    pkgs.openssh
                  ]
                }

              runHook postInstall
            '';

            meta = {
              description = package.description;
              homepage = package.homepage;
              license = nixpkgs.lib.licenses.mit;
              mainProgram = "outfitter";
            };
          };

          default = outfitter;

          container = mkContainer {
            inherit pkgs;
            outfitterPackage = outfitter;
          };
        }
      );
    };
}
