//! Japanese summary prompts, ported verbatim from the original
//! `src/prompts.yaml`. Kept as embedded constants so the binary is
//! self-contained (no runtime file load).

use crate::hacker_news::Article;

/// System instruction describing the desired output shape (summary + optional
/// discussion points, Japanese, length limits, Slack markdown).
pub const OUTPUT_FORMAT_INSTRUCTION: &str = r#"# AI要約生成指示

あなたは、提供されたHacker Newsの記事情報から**要約と議論のポイントのみ**を
日本語で生成するAIです。

**出力形式:**
記事の核心を捉えた簡潔な日本語の要約（2-3文程度、150文字以内厳守）を出力してください。

**コメントがある場合のみ追加:**
改行後に「主な議論ポイント:」として代表的なコメントや議論のポイントを1-2点、
箇条書きで記述してください（各ポイントは1文程度、75文字以内）。

**マークダウンの使用:**
- 太字: `*テキスト*`
- イタリック: `_テキスト_` (必要に応じて)
- リスト: 行頭に `•` を使用。

**出力例:**
新技術Xは、これまでの問題を解決する画期的なアプローチを採用しており、
特にパフォーマンス面で注目されています。
初期のレビューでは肯定的な評価が多いです。

*主な議論ポイント:*
• これは本当にゲームチェンジャーになる可能性があるとの声が多数あります。
• 一方で、セキュリティ面での懸念や既存システムとの互換性についての指摘もいくつか見られます。"#;

/// How many comments to feed the model, and how many characters of each.
const MAX_PROMPT_COMMENTS: usize = 5;
const MAX_COMMENT_CHARS: usize = 200;

/// Builds the user prompt: the article context block followed by the
/// generation guidelines (the `mainPromptTemplate` from the original YAML with
/// `${articleInfoForContext}` substituted).
pub fn build_user_prompt(article: &Article) -> String {
    let context = build_article_context(article);
    format!(
        r#"以下のHacker Newsの記事情報を分析してください。

{context}

上記の「AI要約生成指示」に従って、記事の要約と議論のポイントのみを生成してください。

重要なガイドライン:
- **要約:** 記事の核心を捉えた簡潔な日本語で、*2-3文程度、150文字以内*にしてください。
- **議論ポイント:** 上記の「主なコメント」セクションを参考に、
  代表的なものを*1-2点*、箇条書きで記述してください。
  各ポイントは*1文程度、75文字以内*としてください。
  コメント情報がない場合は、このセクションは省略してください。
- **言語:** 全て日本語で記述してください。
- **フォーマット:** 要約テキストのみを出力してください。
  追加のヘッダーや挨拶、前置き、後書きは一切不要です。"#
    )
}

/// Assembles the `${articleInfoForContext}` block: title, link, optional body,
/// and a numbered list of (cleaned, truncated) comments.
fn build_article_context(article: &Article) -> String {
    let mut out = format!(
        "記事タイトル: {}\n記事リンク: {}\n",
        article.title, article.link
    );
    if article.description != article.title {
        out.push_str(&format!("記事内容: {}\n", article.description));
    }
    if !article.comments.is_empty() {
        out.push_str("\nコメント:\n");
        let lines: Vec<String> = article
            .comments
            .iter()
            .take(MAX_PROMPT_COMMENTS)
            .enumerate()
            .map(|(i, comment)| {
                let cleaned = clean_comment(comment);
                format!("{}. {}", i + 1, cleaned)
            })
            .collect();
        out.push_str(&lines.join("\n"));
    }
    out
}

/// Flattens newlines, swaps backticks for apostrophes, and truncates to
/// `MAX_COMMENT_CHARS` characters (char-aware, so multibyte text is safe).
fn clean_comment(comment: &str) -> String {
    comment
        .replace('\n', " ")
        .replace('`', "'")
        .chars()
        .take(MAX_COMMENT_CHARS)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hacker_news::{Article, ArticleType};

    fn sample(comments: Vec<String>, description: &str) -> Article {
        Article {
            hacker_news_id: 1,
            title: "Example".into(),
            link: "https://example.com".into(),
            description: description.into(),
            comments,
            score: Some(10),
            author: Some("alice".into()),
            comment_count: 3,
            article_type: ArticleType::Story,
            published_at: 0,
        }
    }

    #[test]
    fn omits_body_when_equal_to_title() {
        let prompt = build_article_context(&sample(vec![], "Example"));
        assert!(!prompt.contains("記事内容:"));
    }

    #[test]
    fn includes_body_when_distinct() {
        let prompt = build_article_context(&sample(vec![], "Some body text"));
        assert!(prompt.contains("記事内容: Some body text"));
    }

    #[test]
    fn limits_and_cleans_comments() {
        let long = format!("line1\nline2 `code` {}", "x".repeat(300));
        let prompt = build_article_context(&sample(vec![long; 8], "body"));
        // Only the first 5 comments are numbered.
        assert!(prompt.contains("5. "));
        assert!(!prompt.contains("6. "));
        // Backticks and newlines are flattened.
        assert!(!prompt.contains('`'));
        assert!(!prompt.contains("line1\nline2"));
    }
}
