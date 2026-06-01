//! Article summarization: builds the prompt and calls Cloudflare Workers AI.

use crate::cloudflare::{CloudflareError, Message, WorkersAiClient};
use crate::hacker_news::Article;
use crate::prompts::{OUTPUT_FORMAT_INSTRUCTION, build_user_prompt};

/// Generates a Japanese summary (and optional discussion points) for one
/// article. Returns the trimmed assistant text.
pub async fn summarize(
    client: &WorkersAiClient,
    article: &Article,
) -> Result<String, CloudflareError> {
    let messages = [
        Message::system(OUTPUT_FORMAT_INSTRUCTION),
        Message::user(build_user_prompt(article)),
    ];
    client.complete(&messages).await
}
