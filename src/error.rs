//! Domain error types, aggregated into [`AppError`] for the top-level run.

use crate::cloudflare::CloudflareError;
use crate::config::ConfigError;
use crate::hacker_news::HackerNewsError;
use crate::slack::SlackError;
use crate::state::StateError;

/// Aggregate error for the whole pipeline. Each stage keeps its own
/// fine-grained error type; this enum just lets `run()` return one `Result`.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("configuration error: {0}")]
    Config(#[from] ConfigError),

    #[error("Hacker News error: {0}")]
    HackerNews(#[from] HackerNewsError),

    #[error("Cloudflare Workers AI error: {0}")]
    Cloudflare(#[from] CloudflareError),

    #[error("Slack error: {0}")]
    Slack(#[from] SlackError),

    #[error("state store error: {0}")]
    State(#[from] StateError),
}
