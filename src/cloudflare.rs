//! Cloudflare Workers AI client (OpenAI-compatible chat completions).
//!
//! Replaces the original Gemini integration. The summary pass wants free-form
//! Japanese text (not structured JSON), so this client returns the assistant
//! message content as a plain string.

use crate::http::ResponseExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, thiserror::Error)]
pub enum CloudflareError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error(transparent)]
    Api(#[from] crate::http::HttpApiError),

    #[error("failed to decode response: {0}")]
    Decode(String),

    #[error("response contained no choices")]
    NoChoices,

    #[error("response content was empty")]
    EmptyContent,
}

/// A single chat message.
#[derive(Debug, Serialize)]
pub struct Message {
    pub role: &'static str,
    pub content: String,
}

impl Message {
    pub fn system(content: impl Into<String>) -> Self {
        Self {
            role: "system",
            content: content.into(),
        }
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self {
            role: "user",
            content: content.into(),
        }
    }
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: &'a [Message],
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Debug, Deserialize)]
struct Choice {
    message: ChoiceMessage,
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChoiceMessage {
    /// Most Workers AI models return a string here; a few return a nested JSON
    /// value. Accept both and normalize to a string.
    #[serde(default)]
    content: serde_json::Value,
}

pub struct WorkersAiClient {
    http: Client,
    endpoint: String,
    api_token: String,
    model: String,
    timeout: Duration,
}

impl WorkersAiClient {
    pub fn new(
        http: Client,
        account_id: &str,
        api_token: &str,
        model: &str,
        timeout: Duration,
    ) -> Self {
        let endpoint = format!(
            "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1/chat/completions"
        );
        Self {
            http,
            endpoint,
            api_token: api_token.to_string(),
            model: model.to_string(),
            timeout,
        }
    }

    /// Sends a chat completion request and returns the assistant text content.
    pub async fn complete(&self, messages: &[Message]) -> Result<String, CloudflareError> {
        let request = ChatRequest {
            model: &self.model,
            messages,
            temperature: Some(0.3),
            max_tokens: Some(1024),
        };

        let response: ChatResponse = self
            .http
            .post(&self.endpoint)
            .timeout(self.timeout)
            .bearer_auth(&self.api_token)
            .json(&request)
            .send()
            .await?
            .ensure_success("cloudflare workers ai")
            .await?
            .json()
            .await
            .map_err(|e| CloudflareError::Decode(e.to_string()))?;

        let choice = response
            .choices
            .into_iter()
            .next()
            .ok_or(CloudflareError::NoChoices)?;
        if choice.finish_reason.as_deref() == Some("length") {
            tracing::warn!("cloudflare response was truncated (finish_reason=length)");
        }

        let text = match choice.message.content {
            serde_json::Value::String(s) => s,
            serde_json::Value::Null => String::new(),
            other => other.to_string(),
        };
        let text = text.trim().to_string();
        if text.is_empty() {
            return Err(CloudflareError::EmptyContent);
        }
        Ok(text)
    }
}
