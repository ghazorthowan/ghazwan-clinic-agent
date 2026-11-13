BEGIN;

-- Patient consent tracking on contacts
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS consent_given_at  timestamptz,
  ADD COLUMN IF NOT EXISTS consent_ip        text,         -- IP/channel at consent time
  ADD COLUMN IF NOT EXISTS data_deleted_at   timestamptz;  -- right-to-forget erasure timestamp

-- Soft-delete guard: index to find unerased active contacts quickly
CREATE INDEX IF NOT EXISTS idx_contacts_active
  ON contacts (id)
  WHERE data_deleted_at IS NULL;

-- Contacts pending consent (no consent yet, not erased)
CREATE INDEX IF NOT EXISTS idx_contacts_pending_consent
  ON contacts (id)
  WHERE consent_given_at IS NULL AND data_deleted_at IS NULL;

-- Track schema version so /api/health can report it
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  description text NOT NULL
);

INSERT INTO schema_migrations (version, description) VALUES
  (1,  '001_init'),
  (2,  '002_staff_auth'),
  (3,  '003_staff_lockout'),
  (4,  '004_audit_log'),
  (5,  '005_whatsapp_webhook'),
  (6,  '006_outbox'),
  (7,  '007_audit_actor_type'),
  (8,  '008_rate_limit'),
  (9,  '009_delivery_status'),
  (10, '010_m3_channels'),
  (11, '011_faq'),
  (12, '012_consent')
ON CONFLICT DO NOTHING;

COMMIT;
