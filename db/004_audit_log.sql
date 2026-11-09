-- General-purpose staff audit log (not booking-scoped)
CREATE TABLE IF NOT EXISTS staff_audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES staff_users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Extend clinic_closures with actor tracking
ALTER TABLE clinic_closures
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES staff_users(id),
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES staff_users(id);
