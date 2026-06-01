//! hacker-news-summarizer
//!
//! Fetches the current top Hacker News stories, summarizes each in Japanese
//! via Cloudflare Workers AI, and posts the summaries to Slack. A local SQLite
//! store records posted story ids so repeated (timer-driven) runs don't
//! re-post the same stories.
//!
//! This is a Rust port of the original Google Apps Script application; the
//! Gemini summary step is replaced by Cloudflare Workers AI.

mod cloudflare;
mod config;
mod error;
mod hacker_news;
mod http;
mod prompts;
mod slack;
mod slack_message;
mod state;
mod summarizer;

use crate::cloudflare::WorkersAiClient;
use crate::config::Config;
use crate::error::AppError;
use crate::hacker_news::HackerNewsClient;
use crate::slack::SlackClient;
use crate::state::StateStore;
use crate::summarizer::summarize;
use chrono::Utc;
use reqwest::Client;
use std::time::Duration;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

const USER_AGENT: &str =
    "hacker-news-summarizer/0.1 (+https://github.com/usabarashi/hacker-news-summarizer)";
/// Pause between Slack posts to stay within the chat.postMessage rate limit.
const POST_INTERVAL: Duration = Duration::from_millis(3200);

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    if rustls::crypto::ring::default_provider()
        .install_default()
        .is_err()
    {
        warn!("rustls crypto provider was already installed");
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    if let Err(e) = run().await {
        error!("fatal: {e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), AppError> {
    let config = Config::from_env()?;
    info!(
        article_count = config.article_count,
        model = %config.cloudflare.model,
        channel = %config.slack.channel,
        state_db = %config.state_db_path.display(),
        "starting hacker-news-summarizer"
    );

    let http = Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .expect("failed to build reqwest client");

    let store = StateStore::open(&config.state_db_path)?;
    let news = HackerNewsClient::new(http.clone());
    let summarizer = WorkersAiClient::new(
        http.clone(),
        &config.cloudflare.account_id,
        &config.cloudflare.api_token,
        &config.cloudflare.model,
        Duration::from_secs(config.cloudflare.timeout_secs),
    );
    let slack = SlackClient::new(
        http,
        &config.slack.channel,
        &config.slack.bot_token,
        &config.slack.username,
        &config.cloudflare.model,
    );

    // Collect up to `article_count` stories that have not been posted before.
    let articles = news
        .fetch_top_stories(config.article_count, |id| match store.is_posted(id) {
            Ok(posted) => posted,
            Err(e) => {
                // Fail closed: when the dedup lookup is broken (corruption,
                // lock, permissions), treat the story as already posted and
                // skip it rather than risk re-posting duplicates to Slack.
                warn!(story_id = id, error = %e, "dedup lookup failed; skipping story");
                true
            }
        })
        .await?;

    if articles.is_empty() {
        info!("no fresh top stories to post; exiting");
        return Ok(());
    }
    info!(count = articles.len(), "fetched fresh stories");

    let mut posted = 0usize;
    for (i, article) in articles.iter().enumerate() {
        if i > 0 {
            tokio::time::sleep(POST_INTERVAL).await;
        }

        let summary = match summarize(&summarizer, article).await {
            Ok(s) => s,
            Err(e) => {
                warn!(
                    story_id = article.hacker_news_id,
                    title = %article.title,
                    error = %e,
                    "summary generation failed; skipping article"
                );
                continue;
            }
        };

        match slack.post_article(article, &summary).await {
            Ok(()) => {
                store.mark_posted(article.hacker_news_id, &Utc::now().to_rfc3339())?;
                posted += 1;
                info!(story_id = article.hacker_news_id, title = %article.title, "posted summary");
            }
            Err(e) => {
                warn!(
                    story_id = article.hacker_news_id,
                    title = %article.title,
                    error = %e,
                    "Slack post failed; skipping article"
                );
            }
        }
    }

    info!(posted, "run complete");
    Ok(())
}
