-- Provider message ID for replay protection (one row per inbound Meta message).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_timestamp timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS messages_provider_message_id_key
  ON messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- 24-hour messaging window: track when the window reopens per conversation.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS window_expires_at timestamptz;

-- Allow upsert on conversations keyed by (contact_id, channel).
CREATE UNIQUE INDEX IF NOT EXISTS conversations_contact_channel_key
  ON conversations (contact_id, channel);
