//! Shared HTTP helpers.
//!
//! `ensure_success` turns a non-2xx response into a structured error that
//! carries the status and a length-bounded snippet of the response body, so
//! upstream API failures surface a useful message instead of a bare status
//! code.

use reqwest::{Response, StatusCode};

/// Cap on how many bytes of an error response body we keep for diagnostics.
const MAX_ERROR_BODY_BYTES: usize = 64 * 1024;

#[derive(Debug, thiserror::Error)]
#[error("{context} failed (status {status}): {body}")]
pub struct HttpApiError {
    pub context: String,
    pub status: StatusCode,
    pub body: String,
}

pub trait ResponseExt {
    /// Returns the response unchanged on a 2xx status; otherwise reads a
    /// bounded prefix of the body and returns an [`HttpApiError`].
    async fn ensure_success(self, context: &str) -> Result<Response, HttpApiError>;
}

impl ResponseExt for Response {
    async fn ensure_success(self, context: &str) -> Result<Response, HttpApiError> {
        if self.status().is_success() {
            return Ok(self);
        }
        let status = self.status();
        let body = read_limited_body(self).await;
        Err(HttpApiError {
            context: context.to_string(),
            status,
            body,
        })
    }
}

async fn read_limited_body(response: Response) -> String {
    match response.text().await {
        Ok(text) if text.len() > MAX_ERROR_BODY_BYTES => {
            let mut truncated = text;
            truncated.truncate(MAX_ERROR_BODY_BYTES);
            truncated.push_str("... (truncated)");
            truncated
        }
        Ok(text) => text,
        Err(e) => format!("<failed to read response body: {e}>"),
    }
}
