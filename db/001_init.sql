BEGIN;
CREATE TABLE IF NOT EXISTS clinic_closures (
  closure_date date PRIMARY KEY,
  reason_public text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  phone text,
  source_channel text NOT NULL CHECK (source_channel IN ('SIMULATED_WHATSAPP','WA_01','WA_02','WA_03','INSTAGRAM','FACEBOOK','TIKTOK','WIX')),
  external_contact_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_channel, external_contact_ref)
);
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text NOT NULL UNIQUE,
  contact_id uuid NOT NULL REFERENCES contacts(id),
  clinic_date date NOT NULL,
  status text NOT NULL DEFAULT 'AWAITING_PATIENT' CHECK (status IN ('AWAITING_PATIENT','CONFIRMED','CANCELLED','NEEDS_STAFF','COMPLETED')),
  attendance_status text NOT NULL DEFAULT 'EXPECTED' CHECK (attendance_status IN ('EXPECTED','ARRIVED','NO_SHOW','COMPLETED')),
  confirmed_at timestamptz,
  arrived_at timestamptz,
  arrival_sequence integer,
  last_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_day ON bookings(clinic_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_active_contact_day ON bookings(contact_id,clinic_date) WHERE status IN ('AWAITING_PATIENT','CONFIRMED','NEEDS_STAFF');
CREATE UNIQUE INDEX IF NOT EXISTS idx_arrival_order ON bookings(clinic_date,arrival_sequence) WHERE arrival_sequence IS NOT NULL;
CREATE TABLE IF NOT EXISTS booking_events (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL,
  actor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  channel text NOT NULL,
  status text NOT NULL DEFAULT 'AI' CHECK(status IN ('AI','HUMAN')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  direction text NOT NULL CHECK(direction IN ('IN','OUT')),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_outbox (
  id bigserial PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  revision integer NOT NULL DEFAULT 1,
  synced_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id,revision)
);
COMMIT;
