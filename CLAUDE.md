# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Rust application that fetches the current top Hacker News stories,
generates Japanese summaries via **Cloudflare Workers AI**, and posts them to
Slack. It runs as a systemd oneshot on a timer (NixOS), deduplicating already
posted stories via a local SQLite store.

It is a Rust port of an earlier Google Apps Script / TypeScript version; the
Gemini summary step was replaced by Cloudflare Workers AI. The design follows
the sibling bots in this fleet (`twitter-bot`, `bluesky-bot`, `paper-curator`).

## Development Commands

```bash
# Enter the dev shell (Rust toolchain, sqlite, pkg-config, openssl)
nix develop

# Build / test / lint
cargo build
cargo test
cargo clippy -- -D warnings
cargo fmt

# Run locally (reads .env via dotenvy; see .env.sample)
cargo run

# Flake checks (fmt + clippy + test), x86_64-linux target
nix flake check
```

## Architecture

Pipeline, one module per concern (`src/`):

1. **config.rs** — environment-variable configuration. Secrets use the
   `{NAME}_FILE` (preferred, from systemd `LoadCredential`) over `{NAME}`
   convention.
2. **hacker_news.rs** — Hacker News Firebase API client (top stories, item
   details, comments). Walks up to 30 top stories, skipping ids the caller
   marks as already-posted, until `ARTICLE_COUNT` fresh stories are collected.
3. **prompts.rs** — embedded Japanese summary prompts (ported from the original
   `prompts.yaml`).
4. **cloudflare.rs** — Cloudflare Workers AI client (OpenAI-compatible
   `/ai/v1/chat/completions`); returns the assistant text.
5. **summarizer.rs** — builds the prompt and calls the Workers AI client.
6. **slack.rs** / **slack_message.rs** — Slack `chat.postMessage` client (with
   bounded retries) and the rich-attachment payload builder.
7. **state.rs** — SQLite dedup store (`hacker_news_id` → posted timestamp).
8. **main.rs** — orchestration: fetch → summarize → post → mark posted.
9. **http.rs** / **error.rs** — shared `ensure_success` helper and aggregate
   error type.

### Key behaviors

- **Stateless toward Slack on empty**: when no fresh stories are found, the run
  logs and exits without posting (unlike the original, which posted a
  "not found" message) — dedup makes empty runs normal on a frequent timer.
- **Per-article fault isolation**: a summary or Slack failure for one story is
  logged and skipped; the run continues with the others.
- **Rate limiting**: a fixed pause between Slack posts (`POST_INTERVAL`).

## Environment Variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | — | Cloudflare account |
| `CLOUDFLARE_API_TOKEN` / `_FILE` | ✅ | — | Workers AI token |
| `CLOUDFLARE_MODEL` | ❌ | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | summary model |
| `CLOUDFLARE_TIMEOUT_SECS` | ❌ | `300` | per-call timeout |
| `SLACK_BOT_TOKEN` / `_FILE` | ✅ | — | `xoxb-…` |
| `SLACK_CHANNEL` | ❌ | `#general` | target channel |
| `SLACK_USERNAME` | ❌ | `Hacker News Summarizer` | display name |
| `ARTICLE_COUNT` | ❌ | `3` | fresh stories per run |
| `STATE_DB_PATH` | ❌ | `$STATE_DIRECTORY/state.db` or `./state.db` | dedup DB |
| `RUST_LOG` | ❌ | `info` | log level |

## NixOS Deployment

The flake exports `nixosModules.default`, which defines
`services.hacker-news-summarizer.*` (a systemd oneshot + timer with hardening,
`LoadCredential` secrets, and a `StateDirectory`-derived SQLite path). A
consuming host imports the module, sets `enable = true`, the Cloudflare account
id, the secret file paths (typically from sops), and the target Slack channel.
Build target is `x86_64-linux`.
