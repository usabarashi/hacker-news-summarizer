# hacker-news-summarizer package definition.
#
# Builds the Rust binary with crane so dependency compilation is cached across
# source-only edits. The function takes the same inputs the flake's per-system
# block already exposes (pkgs, crane, rust toolchain); flake.nix wires them in
# and re-exports the result as `packages.<system>.default`.
{
  pkgs,
  crane,
  rustToolchain,
}:

let
  craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;

  src = craneLib.cleanCargoSource ../.;

  commonArgs = {
    inherit src;
    strictDeps = true;

    # `rusqlite` (bundled) compiles SQLite from source via `cc`. `reqwest`
    # selects `rustls-tls`, but some transitive crates still link libssl
    # unconditionally on Linux — keeping openssl available avoids a long tail
    # of "missing libssl.so" errors. Use the default output (not `openssl.dev`)
    # so the runtime `.so` files land on the RPATH; pkg-config still resolves
    # the headers from the propagated dev output.
    buildInputs = with pkgs; [ openssl ];
    nativeBuildInputs = with pkgs; [ pkg-config ];
  };

  cargoArtifacts = craneLib.buildDepsOnly (
    commonArgs
    // {
      pname = "hacker-news-summarizer-deps";
    }
  );
in
{
  package = craneLib.buildPackage (
    commonArgs
    // {
      inherit cargoArtifacts;
      meta = {
        mainProgram = "hacker-news-summarizer";
        description = "Fetch top Hacker News stories, summarize them in Japanese via Cloudflare Workers AI, and post to Slack";
      };
    }
  );

  checks = {
    fmt = craneLib.cargoFmt { inherit src; };

    clippy = craneLib.cargoClippy (
      commonArgs
      // {
        inherit cargoArtifacts;
        cargoClippyExtraArgs = "-- -D warnings";
      }
    );

    test = craneLib.cargoTest (
      commonArgs
      // {
        inherit cargoArtifacts;
      }
    );
  };
}
