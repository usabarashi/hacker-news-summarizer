//! SQLite-backed dedup store.
//!
//! Records the Hacker News id of every story we have already posted so that
//! repeated timer fires don't re-post the same stories. Mirrors the
//! paper-curator state pattern; the database lives under the systemd
//! `StateDirectory` (`/var/lib/hacker-news-summarizer/state.db`).

use rusqlite::Connection;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum StateError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct StateStore {
    conn: Connection,
}

impl StateStore {
    /// Opens (creating if needed) the dedup database at `path` and ensures the
    /// schema exists.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, StateError> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS posted (
                 hacker_news_id INTEGER PRIMARY KEY,
                 posted_at      TEXT NOT NULL
             );",
        )?;
        Ok(Self { conn })
    }

    /// Opens an in-memory store (used by tests).
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self, StateError> {
        let conn = Connection::open_in_memory()?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS posted (
                 hacker_news_id INTEGER PRIMARY KEY,
                 posted_at      TEXT NOT NULL
             );",
        )?;
        Ok(Self { conn })
    }

    /// Returns whether the given story id has already been posted.
    pub fn is_posted(&self, id: u64) -> Result<bool, StateError> {
        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM posted WHERE hacker_news_id = ?1",
            [id as i64],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Marks a story id as posted (idempotent).
    pub fn mark_posted(&self, id: u64, posted_at_rfc3339: &str) -> Result<(), StateError> {
        self.conn.execute(
            "INSERT OR REPLACE INTO posted (hacker_news_id, posted_at) VALUES (?1, ?2)",
            rusqlite::params![id as i64, posted_at_rfc3339],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_and_detects_posted() {
        let store = StateStore::open_in_memory().unwrap();
        assert!(!store.is_posted(1).unwrap());
        store.mark_posted(1, "2026-06-01T00:00:00Z").unwrap();
        assert!(store.is_posted(1).unwrap());
        // Re-marking is idempotent.
        store.mark_posted(1, "2026-06-01T01:00:00Z").unwrap();
        assert!(store.is_posted(1).unwrap());
    }
}
