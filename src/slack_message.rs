//! Builds the Slack `chat.postMessage` payload, matching the original script's
//! rich attachment: Hacker-News-orange bar, the AI summary as the body, the
//! article title linked to the HN discussion, and a metadata footer.

use crate::hacker_news::Article;
use serde_json::{Value, json};

const HACKER_NEWS_ORANGE: &str = "#FF6600";
const DEFAULT_APP_ICON: &str = "https://platform.slack-edge.com/img/default_application_icon.png";

/// Constructs the JSON body for `chat.postMessage`.
///
/// * `summary` — the AI-generated summary text (Slack mrkdwn).
/// * `model` — model name shown in the footer.
/// * `channel` / `username` — target channel and display name.
pub fn build_message(
    article: &Article,
    summary: &str,
    model: &str,
    channel: &str,
    username: &str,
) -> Value {
    let footer = build_footer(article, model);
    let fallback: String = article.title.chars().take(100).collect();

    json!({
        "channel": channel,
        "text": "",
        "username": username,
        "attachments": [{
            "fallback": fallback,
            "color": HACKER_NEWS_ORANGE,
            "text": summary,
            "mrkdwn_in": ["text", "pretext"],
            "footer": footer,
            "footer_icon": DEFAULT_APP_ICON,
            "ts": article.published_at,
            "title": article.title,
            "title_link": article.discussion_url(),
        }]
    })
}

/// `<score> points | by <author> | <n> comments | [<type>] • Summarized by <model>`,
/// omitting any part that is absent — same shape as the original footer.
fn build_footer(article: &Article, model: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(score) = article.score {
        parts.push(format!("{score} points"));
    }
    if let Some(author) = &article.author {
        parts.push(format!("by {author}"));
    }
    parts.push(format!("{} comments", article.comment_count));
    if let Some(label) = article.article_type.label() {
        parts.push(format!("[{label}]"));
    }

    let meta = parts.join(" | ");
    if meta.is_empty() {
        format!("Hacker News Summarizer (Model: {model})")
    } else {
        format!("{meta} • Summarized by {model}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hacker_news::ArticleType;

    fn sample() -> Article {
        Article {
            hacker_news_id: 42,
            title: "Example Story".into(),
            link: "https://example.com".into(),
            description: "body".into(),
            comments: vec![],
            score: Some(28),
            author: Some("bob".into()),
            comment_count: 45,
            article_type: ArticleType::ShowHn,
            published_at: 1_700_000_000,
        }
    }

    #[test]
    fn footer_includes_all_metadata() {
        let footer = build_footer(&sample(), "test-model");
        assert_eq!(
            footer,
            "28 points | by bob | 45 comments | [Show HN] • Summarized by test-model"
        );
    }

    #[test]
    fn footer_omits_story_label() {
        let mut a = sample();
        a.article_type = ArticleType::Story;
        let footer = build_footer(&a, "m");
        assert!(!footer.contains('['));
    }

    #[test]
    fn message_links_title_to_discussion() {
        let msg = build_message(&sample(), "summary text", "model", "#chan", "HN Bot");
        let attachment = &msg["attachments"][0];
        assert_eq!(
            attachment["title_link"],
            "https://news.ycombinator.com/item?id=42"
        );
        assert_eq!(attachment["text"], "summary text");
        assert_eq!(msg["channel"], "#chan");
        assert_eq!(msg["username"], "HN Bot");
    }
}
