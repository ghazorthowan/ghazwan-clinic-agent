-- Sliding-window rate limit buckets.
-- Each row is one (key, window_start) bucket; the worker function upserts
-- and prunes in a single query so there is no separate cleanup job.

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        int         NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

-- Auto-expire old buckets so the table never grows unboundedly.
-- Rows older than 1 day are dead; a simple periodic delete handles cleanup.
CREATE INDEX IF NOT EXISTS idx_rl_window_start ON rate_limit_buckets (window_start);
