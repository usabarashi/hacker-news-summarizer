//! Configuration, parsed from environment variables.
//!
//! Secrets follow a two-tier convention shared with the sibling bots: a
//! `{NAME}_FILE` variable pointing at a file (preferred, used by the systemd
//! `LoadCredential` wiring) takes precedence over a `{NAME}` variable holding
//! the value directly (convenient for local `.env` development).

use std::path::PathBuf;

/// Default Cloudflare Workers AI model for the Japanese summary pass.
const DEFAULT_CLOUDFLARE_MODEL: &str = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const DEFAULT_CLOUDFLARE_TIMEOUT_SECS: u64 = 300;
const DEFAULT_ARTICLE_COUNT: usize = 3;
const DEFAULT_SLACK_CHANNEL: &str = "#general";
const DEFAULT_SLACK_USERNAME: &str = "Hacker News Summarizer";
const DEFAULT_STATE_DB_FILENAME: &str = "state.db";

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("required environment variable {0} is not set")]
    Missing(String),

    #[error("environment variable {name} is invalid: {reason}")]
    InvalidValue { name: String, reason: String },

    #[error("failed to read secret file {path}: {source}")]
    SecretFile {
        path: String,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Debug, Clone)]
pub struct CloudflareConfig {
    pub account_id: String,
    pub api_token: String,
    pub model: String,
    pub timeout_secs: u64,
}

#[derive(Debug, Clone)]
pub struct SlackConfig {
    pub channel: String,
    pub bot_token: String,
    pub username: String,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub article_count: usize,
    pub cloudflare: CloudflareConfig,
    pub slack: SlackConfig,
    pub state_db_path: PathBuf,
}

impl Config {
    /// Builds the configuration from the process environment.
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_reader(|name| std::env::var(name).ok())
    }

    /// Builds the configuration from an arbitrary variable reader. Used by
    /// `from_env` in production and by the test suite with a fixed map.
    pub fn from_reader(reader: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let r = EnvReader { reader };

        let article_count = match r.optional("ARTICLE_COUNT")? {
            Some(raw) => raw
                .parse::<usize>()
                .map_err(|_| ConfigError::InvalidValue {
                    name: "ARTICLE_COUNT".into(),
                    reason: format!("expected a positive integer, got {raw:?}"),
                })?,
            None => DEFAULT_ARTICLE_COUNT,
        };
        if article_count == 0 {
            return Err(ConfigError::InvalidValue {
                name: "ARTICLE_COUNT".into(),
                reason: "must be at least 1".into(),
            });
        }

        let cloudflare = CloudflareConfig {
            account_id: r.required("CLOUDFLARE_ACCOUNT_ID")?,
            api_token: r.required_secret("CLOUDFLARE_API_TOKEN")?,
            model: r
                .optional("CLOUDFLARE_MODEL")?
                .unwrap_or_else(|| DEFAULT_CLOUDFLARE_MODEL.to_string()),
            timeout_secs: r
                .optional_u64("CLOUDFLARE_TIMEOUT_SECS")?
                .unwrap_or(DEFAULT_CLOUDFLARE_TIMEOUT_SECS),
        };

        let slack = SlackConfig {
            channel: r
                .optional("SLACK_CHANNEL")?
                .unwrap_or_else(|| DEFAULT_SLACK_CHANNEL.to_string()),
            bot_token: r.required_secret("SLACK_BOT_TOKEN")?,
            username: r
                .optional("SLACK_USERNAME")?
                .unwrap_or_else(|| DEFAULT_SLACK_USERNAME.to_string()),
        };

        let state_db_path = match r.optional("STATE_DB_PATH")? {
            Some(p) => PathBuf::from(p),
            None => {
                let dir = r
                    .optional("STATE_DIRECTORY")?
                    .unwrap_or_else(|| ".".to_string());
                // systemd may hand a colon-separated list in STATE_DIRECTORY;
                // the first entry is the canonical one.
                let first = dir.split(':').next().unwrap_or(&dir);
                PathBuf::from(first).join(DEFAULT_STATE_DB_FILENAME)
            }
        };

        Ok(Config {
            article_count,
            cloudflare,
            slack,
            state_db_path,
        })
    }
}

struct EnvReader<F: Fn(&str) -> Option<String>> {
    reader: F,
}

impl<F: Fn(&str) -> Option<String>> EnvReader<F> {
    fn raw(&self, name: &str) -> Option<String> {
        (self.reader)(name)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    }

    fn optional(&self, name: &str) -> Result<Option<String>, ConfigError> {
        Ok(self.raw(name))
    }

    fn optional_u64(&self, name: &str) -> Result<Option<u64>, ConfigError> {
        match self.raw(name) {
            Some(raw) => raw
                .parse::<u64>()
                .map(Some)
                .map_err(|_| ConfigError::InvalidValue {
                    name: name.into(),
                    reason: format!("expected a non-negative integer, got {raw:?}"),
                }),
            None => Ok(None),
        }
    }

    fn required(&self, name: &str) -> Result<String, ConfigError> {
        self.raw(name)
            .ok_or_else(|| ConfigError::Missing(name.into()))
    }

    /// Resolves a secret, preferring `{NAME}_FILE` (a path whose contents are
    /// the value) over `{NAME}` (the value directly).
    fn required_secret(&self, name: &str) -> Result<String, ConfigError> {
        let file_var = format!("{name}_FILE");
        if let Some(path) = self.raw(&file_var) {
            return std::fs::read_to_string(&path)
                .map(|s| s.trim().to_string())
                .map_err(|source| ConfigError::SecretFile { path, source })
                .and_then(|value| {
                    if value.is_empty() {
                        Err(ConfigError::InvalidValue {
                            name: file_var.clone(),
                            reason: "secret file is empty or whitespace-only".into(),
                        })
                    } else {
                        Ok(value)
                    }
                });
        }
        self.required(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn reader(map: HashMap<&'static str, &'static str>) -> impl Fn(&str) -> Option<String> {
        move |name: &str| map.get(name).map(|s| s.to_string())
    }

    #[test]
    fn applies_defaults() {
        let cfg = Config::from_reader(reader(HashMap::from([
            ("CLOUDFLARE_ACCOUNT_ID", "acct"),
            ("CLOUDFLARE_API_TOKEN", "cf-token"),
            ("SLACK_BOT_TOKEN", "xoxb-token"),
        ])))
        .expect("config should build with required vars only");

        assert_eq!(cfg.article_count, DEFAULT_ARTICLE_COUNT);
        assert_eq!(cfg.cloudflare.model, DEFAULT_CLOUDFLARE_MODEL);
        assert_eq!(cfg.cloudflare.timeout_secs, DEFAULT_CLOUDFLARE_TIMEOUT_SECS);
        assert_eq!(cfg.slack.channel, DEFAULT_SLACK_CHANNEL);
        assert_eq!(cfg.slack.username, DEFAULT_SLACK_USERNAME);
        assert_eq!(cfg.state_db_path, PathBuf::from("./state.db"));
    }

    #[test]
    fn missing_required_is_error() {
        let err = Config::from_reader(reader(HashMap::new())).unwrap_err();
        assert!(matches!(err, ConfigError::Missing(_)));
    }

    #[test]
    fn rejects_zero_article_count() {
        let err = Config::from_reader(reader(HashMap::from([
            ("CLOUDFLARE_ACCOUNT_ID", "acct"),
            ("CLOUDFLARE_API_TOKEN", "cf-token"),
            ("SLACK_BOT_TOKEN", "xoxb-token"),
            ("ARTICLE_COUNT", "0"),
        ])))
        .unwrap_err();
        assert!(matches!(err, ConfigError::InvalidValue { .. }));
    }

    #[test]
    fn derives_state_db_from_state_directory() {
        let cfg = Config::from_reader(reader(HashMap::from([
            ("CLOUDFLARE_ACCOUNT_ID", "acct"),
            ("CLOUDFLARE_API_TOKEN", "cf-token"),
            ("SLACK_BOT_TOKEN", "xoxb-token"),
            ("STATE_DIRECTORY", "/var/lib/hacker-news-summarizer"),
        ])))
        .unwrap();
        assert_eq!(
            cfg.state_db_path,
            PathBuf::from("/var/lib/hacker-news-summarizer/state.db")
        );
    }
}
