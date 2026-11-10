-- Durable outbox columns for outbound messages.
-- sent_at NULL means not yet delivered; non-NULL means delivered successfully.
-- send_attempts tracks how many delivery attempts have been made.
-- last_error stores the last failure reason for alerting/debugging.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sent_at         timestamptz,
  ADD COLUMN IF NOT EXISTS send_attempts   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error      text;

-- phone_number_id: which WA Business number to send from.
-- Populated at insert time for OUT messages; NULL for IN.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS phone_number_id text;

-- Index for the outbox worker: unsent OUT rows, oldest first.
CREATE INDEX IF NOT EXISTS idx_messages_outbox
  ON messages (created_at)
  WHERE direction = 'OUT' AND sent_at IS NULL;

-- Store the WA phone_number_id on conversations so OUT messages can be routed.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS phone_number_id text;
