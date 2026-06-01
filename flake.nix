{
  description = "hacker-news-summarizer — fetch top Hacker News stories, summarize them in Japanese via Cloudflare Workers AI, and post to Slack";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    crane.url = "github:ipetkov/crane";
  };

  outputs =
    {
      self,
      nixpkgs,
      rust-overlay,
      crane,
    }:
    let
      # Build targets: x86_64-linux only (deploy host YN1505AF21679). CI on the
      # self-hosted runner leaves the artifact in the host's /nix/store, which
      # the infrastructure flake then references.
      buildSystems = [ "x86_64-linux" ];
      # Dev targets: Linux x86_64/aarch64 + macOS aarch64.
      devSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      allSystems = nixpkgs.lib.unique (buildSystems ++ devSystems);

      forBuildSystems = f: nixpkgs.lib.genAttrs buildSystems f;
      forDevSystems = f: nixpkgs.lib.genAttrs devSystems f;
      forAllSystems = f: nixpkgs.lib.genAttrs allSystems f;

      pkgsFor =
        system:
        import nixpkgs {
          inherit system;
          overlays = [ (import rust-overlay) ];
        };

      buildToolchainFor =
        system:
        (pkgsFor system).rust-bin.stable.latest.minimal.override {
          extensions = [
            "clippy"
            "rustfmt"
          ];
        };

      devToolchainFor =
        system:
        (pkgsFor system).rust-bin.stable.latest.default.override {
          extensions = [
            "rust-src"
            "rust-analyzer"
          ];
        };

      buildOutputsFor =
        system:
        import ./nix/package.nix {
          pkgs = pkgsFor system;
          inherit crane;
          rustToolchain = buildToolchainFor system;
        };
    in
    {
      packages = forBuildSystems (
        system: rec {
          hacker-news-summarizer = (buildOutputsFor system).package;
          default = hacker-news-summarizer;
        }
      );

      apps = forBuildSystems (system: {
        default = {
          type = "app";
          program = "${(buildOutputsFor system).package}/bin/hacker-news-summarizer";
        };
      });

      checks = forBuildSystems (system: (buildOutputsFor system).checks);

      # NixOS module exporting the `services.hacker-news-summarizer.*` option
      # tree. Consumers import this module, set `enable = true` plus a few
      # host-specific overrides (Cloudflare account, secret file paths, target
      # channel) to get a running oneshot unit + timer.
      nixosModules.default =
        { pkgs, lib, ... }:
        {
          imports = [ ./nix/module.nix ];
          services.hacker-news-summarizer.package =
            lib.mkDefault self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };

      devShells = forDevSystems (
        system:
        let
          pkgs = pkgsFor system;
          devToolchain = devToolchainFor system;
        in
        {
          default = pkgs.mkShell {
            buildInputs = [
              devToolchain
              pkgs.openssl
            ];
            nativeBuildInputs = with pkgs; [
              pkg-config
              sqlite
            ];
          };
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt-rfc-style);
    };
}
