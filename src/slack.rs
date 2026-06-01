//! Slack `chat.postMessage` client with bounded retries.
//!
//! Retries transient failures (network errors, 5xx, and 429 with `Retry-After`)
//! up to a small cap. A successful HTTP response is still checked for the
//! Slack `ok: true` field, since Slack reports application errors in the body.

use crate::hacker_news::Article;
use crate::http::ResponseExt;
use crate::slack_message::build_message;
use reqwest::{Client, StatusCode};
use std::num::NonZeroU32;
use std::time::Duration;

const POST_MESSAGE_URL: &str = "https://slack.com/api/chat.postMessage";
const MAX_ATTEMPTS: NonZeroU32 = NonZeroU32::new(3).unwrap();
const RETRY_DELAY: Duration = Duration::from_secs(1);
const DEFAULT_RATE_LIMIT_DELAY: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum SlackError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error(transparent)]
    Api(#[from] crate::http::HttpApiError),

    #[error("failed to decode Slack response: {0}")]
    Decode(String),

    #[error("Slack API returned an error: {0}")]
    Slack(String),

    #[error("exhausted retries posting to Slack")]
    Exhausted,
}

pub struct SlackClient {
    http: Client,
    channel: String,
    bot_token: String,
    username: String,
    model: String,
}

impl SlackClient {
    pub fn new(
        http: Client,
        channel: impl Into<String>,
        bot_token: impl Into<String>,
        username: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        Self {
            http,
            channel: channel.into(),
            bot_token: bot_token.into(),
            username: username.into(),
            model: model.into(),
        }
    }

    /// Posts one article summary, retrying transient failures.
    pub async fn post_article(&self, article: &Article, summary: &str) -> Result<(), SlackError> {
        let payload = build_message(article, summary, &self.model, &self.channel, &self.username);
        let max = MAX_ATTEMPTS.get();

        for attempt in 1..=max {
            let result = self
                .http
                .post(POST_MESSAGE_URL)
                .bearer_auth(&self.bot_token)
                .json(&payload)
                .send()
                .await;

            let response = match result {
                Ok(r) => r,
                Err(e) => {
                    if attempt < max {
                        tracing::warn!(attempt, error = %e, "Slack request failed; retrying");
                        tokio::time::sleep(RETRY_DELAY).await;
                        continue;
                    }
                    return Err(SlackError::Request(e));
                }
            };

            let status = response.status();
            if status == StatusCode::TOO_MANY_REQUESTS {
                let delay = retry_after(&response).unwrap_or(DEFAULT_RATE_LIMIT_DELAY);
                if attempt < max {
                    tracing::warn!(attempt, ?delay, "Slack rate limited; retrying");
                    tokio::time::sleep(delay).await;
                    continue;
                }
                return Err(SlackError::Slack("rate limited (429)".into()));
            }
            if status.is_server_error() && attempt < max {
                tracing::warn!(attempt, %status, "Slack server error; retrying");
                tokio::time::sleep(RETRY_DELAY).await;
                continue;
            }

            let body: serde_json::Value = response
                .ensure_success("Slack chat.postMessage")
                .await?
                .json()
                .await
                .map_err(|e| SlackError::Decode(e.to_string()))?;

            return if body.get("ok").and_then(|v| v.as_bool()) == Some(true) {
                Ok(())
            } else {
                let err = body
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown error");
                Err(SlackError::Slack(err.to_string()))
            };
        }

        Err(SlackError::Exhausted)
    }
}

fn retry_after(response: &reqwest::Response) -> Option<Duration> {
    response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
        .map(Duration::from_secs)
}
