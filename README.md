# hacker-news-summarizer

Fetches the current top Hacker News stories, summarizes each in Japanese using
**Cloudflare Workers AI**, and posts the summaries to Slack. Designed to run as
a systemd oneshot on a timer (NixOS); a local SQLite store deduplicates stories
so repeated runs don't re-post the same items.

This is a Rust port of the original Google Apps Script version. The Gemini
summary step has been replaced by Cloudflare Workers AI, following the same
deployment pattern as the sibling bots (`twitter-bot`, `bluesky-bot`,
`paper-curator`).

## How it works

1. Fetch the Hacker News top-stories list and walk it (up to 30 entries),
   skipping any story id already recorded in the dedup store, until
   `ARTICLE_COUNT` fresh stories are collected.
2. For each story, build a Japanese summary prompt (title, link, body, and a
   few comments) and call Cloudflare Workers AI.
3. Post each summary to Slack as a rich attachment (Hacker-News-orange bar,
   title linked to the HN discussion, metadata footer).
4. Record posted story ids in SQLite.

A summary or Slack failure for one story is logged and skipped; the rest of the
run continues. When no fresh stories are found, the run exits quietly without
posting.

## Development

```sh
nix develop          # Rust toolchain + sqlite + pkg-config + openssl
cargo build
cargo test
cargo clippy -- -D warnings
cargo fmt
cargo run            # reads .env via dotenvy; see .env.sample
```

For local runs, copy `.env.sample` to `.env` and fill in the Cloudflare and
Slack credentials.

## Configuration

Secrets follow the `{NAME}_FILE` (file path, preferred) over `{NAME}` (value)
convention; the NixOS module wires the `_FILE` variants from systemd
`LoadCredential`.

| Variable | Required | Default | Description |
| :-- | :--: | :-- | :-- |
| `CLOUDFLARE_ACCOUNT_ID` | yes | — | Cloudflare account ID |
| `CLOUDFLARE_API_TOKEN` / `_FILE` | yes | — | Workers AI API token |
| `CLOUDFLARE_MODEL` | no | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | summary model |
| `CLOUDFLARE_TIMEOUT_SECS` | no | `300` | per-call timeout |
| `SLACK_BOT_TOKEN` / `_FILE` | yes | — | Slack bot OAuth token (`xoxb-…`) |
| `SLACK_CHANNEL` | no | `#general` | target channel (ID or `#name`) |
| `SLACK_USERNAME` | no | `Hacker News Summarizer` | display name |
| `ARTICLE_COUNT` | no | `3` | fresh stories per run |
| `STATE_DB_PATH` | no | `$STATE_DIRECTORY/state.db` or `./state.db` | dedup DB |
| `RUST_LOG` | no | `info` | log level |

## NixOS deployment

The flake exports `nixosModules.default`, defining
`services.hacker-news-summarizer.*` (a hardened systemd oneshot + timer,
`LoadCredential` secret handling, and a `StateDirectory`-derived SQLite path).
Build target is `x86_64-linux`.

A consuming host imports the module and sets the host-specific options, e.g.:

```nix
{
  imports = [ inputs.hacker-news-summarizer.nixosModules.default ];

  services.hacker-news-summarizer = {
    enable = true;
    cloudflare.accountId = "<account-id>";
    cloudflare.apiTokenFile = config.sops.secrets."hacker-news-summarizer-cloudflare-api-token".path;
    slack.channel = "#02-engineering-feed";
    slack.botTokenFile = config.sops.secrets."hacker-news-summarizer-slack-bot-token".path;
    # onCalendar defaults to every 6 hours.
  };
}
```

## References

- [Hacker News API](https://github.com/HackerNews/API)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Slack chat.postMessage](https://api.slack.com/methods/chat.postMessage)
