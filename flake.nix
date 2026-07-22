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
    in
    {
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

              makeWrapper ${pkgs.nodejs}/bin/node "$out/bin/outfitter" \
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
        }
      );
    };
}
