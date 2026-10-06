{
  description = "kula: git, with a map";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        version = "1.0.0";

        # The web UI, built with pnpm and embedded into the binary.
        web = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
          pname = "kula-web";
          inherit version;
          src = ./web;
          nativeBuildInputs = [ pkgs.nodejs pkgs.pnpm pkgs.pnpmConfigHook ];
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit (pkgs) pnpm;
            inherit (finalAttrs) pname version src;
            fetcherVersion = 4;
            hash = "sha256-zUu9nZWwUbJzc1PSBuXKAvej7z1uyjbTx0Fgs/WuLcQ=";
          };
          buildPhase = "pnpm exec vite build";
          installPhase = "cp -r dist $out";
        });

        kula = pkgs.rustPlatform.buildRustPackage {
          pname = "kula";
          inherit version;
          src = pkgs.lib.cleanSource ./.;
          cargoLock.lockFile = ./Cargo.lock;
          preBuild = ''
            rm -rf web/dist
            cp -r ${web} web/dist
            chmod -R u+w web/dist
          '';
          nativeCheckInputs = [ pkgs.git ];
          meta = with pkgs.lib; {
            description = "Local-first git client with a knowledge-graph view";
            homepage = "https://github.com/A12N4V/kula";
            license = licenses.gpl3Only;
            mainProgram = "kula";
          };
        };
      in {
        packages.default = kula;
        apps.default = flake-utils.lib.mkApp { drv = kula; };
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [ cargo rustc clippy rustfmt nodejs pnpm git ];
        };
      });
}
