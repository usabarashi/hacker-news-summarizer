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

/// Reads at most `MAX_ERROR_BODY_BYTES` of the response body by streaming
/// chunks, then decodes lossily. Streaming (rather than `text()`) caps memory
/// on a huge error body, and `from_utf8_lossy` avoids the panic that
/// `String::truncate` would raise if the byte cap fell mid-codepoint.
async fn read_limited_body(mut response: Response) -> String {
    let mut buf = Vec::with_capacity(MAX_ERROR_BODY_BYTES.min(4096));
    let mut truncated = false;

    loop {
        match response.chunk().await {
            Ok(Some(chunk)) => {
                let remaining = MAX_ERROR_BODY_BYTES.saturating_sub(buf.len());
                if chunk.len() >= remaining {
                    buf.extend_from_slice(&chunk[..remaining]);
                    truncated = true;
                    break;
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => break,
            Err(e) => return format!("<failed to read response body: {e}>"),
        }
    }

    let mut body = String::from_utf8_lossy(&buf).into_owned();
    if truncated {
        body.push_str("... (truncated)");
    }
    body
}
