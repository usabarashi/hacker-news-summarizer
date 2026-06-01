//! Hacker News Firebase API client.
//!
//! Mirrors the original Google Apps Script behaviour: walk the top-stories
//! list, fetch each item's details, sample a handful of comments, and stop
//! once enough valid stories have been collected. A `skip` predicate lets the
//! caller drop already-posted stories during the walk so the run still yields
//! the requested number of *fresh* articles.

use crate::http::ResponseExt;
use reqwest::Client;
use serde::Deserialize;

const API_BASE: &str = "https://hacker-news.firebaseio.com/v0";
/// How far down the top-stories list to walk before giving up.
const MAX_STORY_IDS_TO_PROCESS: usize = 30;
/// How many comments to attach to each story (sampled from the first
/// `2 * MAX_COMMENTS` kids, matching the original script).
const MAX_COMMENTS: usize = 10;

#[derive(Debug, thiserror::Error)]
pub enum HackerNewsError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),

    #[error(transparent)]
    Api(#[from] crate::http::HttpApiError),

    #[error("failed to decode response: {0}")]
    Decode(String),
}

/// A Hacker News story enriched with the data needed to summarize and post it.
#[derive(Debug, Clone)]
pub struct Article {
    pub hacker_news_id: u64,
    pub title: String,
    /// External URL if present, else the HN discussion permalink.
    pub link: String,
    /// Self-text for Ask/Show posts, else the title (matches the original).
    pub description: String,
    pub comments: Vec<String>,
    pub score: Option<u64>,
    pub author: Option<String>,
    pub comment_count: u64,
    pub article_type: ArticleType,
    /// Story submission time, Unix seconds. Used as the Slack attachment `ts`.
    pub published_at: i64,
}

impl Article {
    pub fn discussion_url(&self) -> String {
        format!(
            "https://news.ycombinator.com/item?id={}",
            self.hacker_news_id
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArticleType {
    ShowHn,
    AskHn,
    TellHn,
    Job,
    Story,
}

impl ArticleType {
    /// Classifies a story. `item_type` is the Hacker News API's canonical
    /// `type` field (`"job"`, `"story"`, …); the Ask/Show/Tell distinction
    /// only exists in the title, so those still use the title prefix.
    fn detect(title: &str, item_type: Option<&str>) -> Self {
        let lower = title.to_lowercase();
        if lower.starts_with("show hn:") {
            ArticleType::ShowHn
        } else if lower.starts_with("ask hn:") {
            ArticleType::AskHn
        } else if lower.starts_with("tell hn:") {
            ArticleType::TellHn
        } else if item_type == Some("job") {
            ArticleType::Job
        } else {
            ArticleType::Story
        }
    }

    /// Display label, or `None` for a plain story (the original omits the
    /// `[Story]` tag from the Slack footer).
    pub fn label(&self) -> Option<&'static str> {
        match self {
            ArticleType::ShowHn => Some("Show HN"),
            ArticleType::AskHn => Some("Ask HN"),
            ArticleType::TellHn => Some("Tell HN"),
            ArticleType::Job => Some("Job"),
            ArticleType::Story => None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct Item {
    id: u64,
    #[serde(rename = "type", default)]
    item_type: Option<String>,
    #[serde(default)]
    deleted: bool,
    #[serde(default)]
    dead: bool,
    #[serde(default)]
    by: Option<String>,
    #[serde(default)]
    time: Option<i64>,
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    kids: Vec<u64>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    score: Option<u64>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    descendants: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct Comment {
    #[serde(default)]
    text: Option<String>,
    #[serde(default)]
    deleted: bool,
    #[serde(default)]
    dead: bool,
}

pub struct HackerNewsClient {
    http: Client,
}

impl HackerNewsClient {
    pub fn new(http: Client) -> Self {
        Self { http }
    }

    /// Walks the top-stories list and returns up to `limit` valid stories for
    /// which `skip(id)` returns `false`.
    pub async fn fetch_top_stories(
        &self,
        limit: usize,
        skip: impl Fn(u64) -> bool,
    ) -> Result<Vec<Article>, HackerNewsError> {
        let ids = self.fetch_top_story_ids().await?;
        let mut articles = Vec::with_capacity(limit);

        for id in ids.into_iter().take(MAX_STORY_IDS_TO_PROCESS) {
            if articles.len() >= limit {
                break;
            }
            if skip(id) {
                tracing::debug!(story_id = id, "skipping already-posted story");
                continue;
            }
            match self.fetch_story(id).await {
                Ok(Some(article)) => articles.push(article),
                Ok(None) => tracing::warn!(story_id = id, "story missing title/time; skipping"),
                Err(e) => {
                    tracing::warn!(story_id = id, error = %e, "failed to fetch story; skipping")
                }
            }
        }

        Ok(articles)
    }

    async fn fetch_top_story_ids(&self) -> Result<Vec<u64>, HackerNewsError> {
        let url = format!("{API_BASE}/topstories.json");
        let ids = self
            .http
            .get(&url)
            .send()
            .await?
            .ensure_success("hacker news topstories")
            .await?
            .json::<Vec<u64>>()
            .await
            .map_err(|e| HackerNewsError::Decode(e.to_string()))?;
        Ok(ids)
    }

    /// Fetches a single story. Returns `Ok(None)` when the item lacks the
    /// critical title/time fields (deleted, dead, or a non-story item).
    async fn fetch_story(&self, id: u64) -> Result<Option<Article>, HackerNewsError> {
        let url = format!("{API_BASE}/item/{id}.json");
        let item = self
            .http
            .get(&url)
            .send()
            .await?
            .ensure_success("hacker news item")
            .await?
            .json::<Option<Item>>()
            .await
            .map_err(|e| HackerNewsError::Decode(e.to_string()))?;

        let Some(item) = item else {
            return Ok(None);
        };
        if item.deleted || item.dead {
            return Ok(None);
        }
        let (Some(title), Some(time)) = (item.title.clone(), item.time) else {
            return Ok(None);
        };

        let comments = self.fetch_comments(&item.kids).await;
        let article_type = ArticleType::detect(&title, item.item_type.as_deref());
        let link = item
            .url
            .clone()
            .unwrap_or_else(|| format!("https://news.ycombinator.com/item?id={}", item.id));
        let description = item.text.clone().unwrap_or_else(|| title.clone());

        Ok(Some(Article {
            hacker_news_id: item.id,
            title,
            link,
            description,
            comments,
            score: item.score,
            author: item.by,
            comment_count: item.descendants.unwrap_or(0),
            article_type,
            published_at: time,
        }))
    }

    /// Fetches up to `MAX_COMMENTS` valid comment bodies, sampling from the
    /// first `2 * MAX_COMMENTS` kids (some are deleted/dead and dropped).
    async fn fetch_comments(&self, kids: &[u64]) -> Vec<String> {
        let mut comments = Vec::with_capacity(MAX_COMMENTS);
        for &kid in kids.iter().take(MAX_COMMENTS * 2) {
            if comments.len() >= MAX_COMMENTS {
                break;
            }
            match self.fetch_comment(kid).await {
                Ok(Some(text)) => comments.push(text),
                Ok(None) => {}
                Err(e) => tracing::warn!(comment_id = kid, error = %e, "failed to fetch comment"),
            }
        }
        comments
    }

    async fn fetch_comment(&self, id: u64) -> Result<Option<String>, HackerNewsError> {
        let url = format!("{API_BASE}/item/{id}.json");
        let comment = self
            .http
            .get(&url)
            .send()
            .await?
            .ensure_success("hacker news comment")
            .await?
            .json::<Option<Comment>>()
            .await
            .map_err(|e| HackerNewsError::Decode(e.to_string()))?;

        Ok(comment.and_then(|c| match c.text {
            Some(text) if !c.deleted && !c.dead && !text.is_empty() => Some(text),
            _ => None,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_article_types() {
        assert_eq!(
            ArticleType::detect("Show HN: my project", Some("story")),
            ArticleType::ShowHn
        );
        assert_eq!(
            ArticleType::detect("Ask HN: how?", Some("story")),
            ArticleType::AskHn
        );
        assert_eq!(
            ArticleType::detect("Tell HN: news", Some("story")),
            ArticleType::TellHn
        );
        // Job is derived from the canonical API `type`, not title keywords.
        assert_eq!(
            ArticleType::detect("ACME (YC S20) is hiring", Some("job")),
            ArticleType::Job
        );
        assert_eq!(
            ArticleType::detect("A title mentioning hiring", Some("story")),
            ArticleType::Story
        );
        assert_eq!(
            ArticleType::detect("A regular story", None),
            ArticleType::Story
        );
    }

    #[test]
    fn story_label_is_none() {
        assert_eq!(ArticleType::Story.label(), None);
        assert_eq!(ArticleType::ShowHn.label(), Some("Show HN"));
    }
}
