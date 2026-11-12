BEGIN;

-- Add updated_at to conversations (needed by PATCH handler)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Extend status constraint to include OPEN (staff-unassigned state)
ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('AI', 'HUMAN', 'OPEN'));

-- Staff assignment: nullable FK — SET NULL when staff member is deleted
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES staff_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_assigned
  ON conversations (assigned_to)
  WHERE assigned_to IS NOT NULL;

-- phone_number_id on messages (needed by outbox worker for multi-number WhatsApp)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS phone_number_id text;

COMMIT;
