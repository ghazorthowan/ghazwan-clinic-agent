BEGIN;

-- Track when Meta confirms delivery of an outbound message.
-- NULL = not yet delivered (or not an outbound message).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Index for ops queries: "find messages sent but never confirmed delivered"
CREATE INDEX IF NOT EXISTS idx_messages_undelivered
  ON messages (sent_at)
  WHERE direction = 'OUT' AND sent_at IS NOT NULL AND delivered_at IS NULL;

COMMIT;
