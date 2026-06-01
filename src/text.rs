//! Small text utilities for handling untrusted Hacker News content.
//!
//! Hacker News item/comment bodies are HTML fragments (`<p>`, `<a>`, `<i>`,
//! `<pre><code>`, plus HTML entities). Before feeding them to the LLM we strip
//! tags, decode the handful of entities HN actually emits, flatten whitespace,
//! and cap the length — this trims wasted tokens and makes the boundary
//! between our instructions and the source text clearer.

/// Cleans an untrusted HTML-ish source string for inclusion in an LLM prompt:
/// strips tags, decodes common entities, swaps backticks for apostrophes,
/// flattens runs of whitespace, and truncates to `max_chars` characters
/// (char-aware, so multibyte text is never split mid-codepoint).
pub fn clean_source_text(input: &str, max_chars: usize) -> String {
    let stripped = strip_tags(input);
    let decoded = decode_entities(&stripped);
    let flattened = flatten_whitespace(&decoded).replace('`', "'");
    flattened.chars().take(max_chars).collect()
}

/// Removes `<...>` tag runs. A `<` with no matching `>` drops the rest.
fn strip_tags(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut in_tag = false;
    for c in input.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}

/// Decodes the small set of HTML entities Hacker News emits. `&amp;` is decoded
/// last so an input like `&amp;lt;` does not collapse into `<`.
fn decode_entities(input: &str) -> String {
    input
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&#39;", "'")
        .replace("&#x2F;", "/")
        .replace("&#47;", "/")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

/// Collapses any run of whitespace (including newlines) into a single space and
/// trims the ends.
fn flatten_whitespace(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_and_decodes_entities() {
        let input = "<p>Hello &amp; <i>world</i> &lt;tag&gt;</p>";
        assert_eq!(clean_source_text(input, 1000), "Hello & world <tag>");
    }

    #[test]
    fn flattens_whitespace_and_backticks() {
        let input = "line1\n\nline2   `code`";
        assert_eq!(clean_source_text(input, 1000), "line1 line2 'code'");
    }

    #[test]
    fn truncates_char_aware() {
        let input = "あ".repeat(10);
        assert_eq!(clean_source_text(&input, 3), "あああ");
    }

    #[test]
    fn unterminated_tag_drops_remainder() {
        assert_eq!(clean_source_text("ok <broken", 1000), "ok");
    }
}
