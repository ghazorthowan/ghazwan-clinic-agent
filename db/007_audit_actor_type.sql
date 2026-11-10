-- Extend staff_audit_log to support AI and system actors alongside staff.
-- actor_id becomes nullable (NULL for AI/SYSTEM); actor_type disambiguates.

ALTER TABLE staff_audit_log
  ALTER COLUMN actor_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'STAFF'
    CHECK (actor_type IN ('STAFF', 'AI', 'SYSTEM'));

-- Index for per-entity history lookups (e.g. all events on a booking).
CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON staff_audit_log (entity_type, entity_id, created_at DESC);
