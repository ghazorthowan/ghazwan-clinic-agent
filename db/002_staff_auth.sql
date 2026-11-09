BEGIN;

CREATE TABLE IF NOT EXISTS staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'RECEPTIONIST' CHECK (role IN ('ADMIN','RECEPTIONIST')),
  is_active boolean NOT NULL DEFAULT true,
  totp_secret text,
  totp_enabled boolean NOT NULL DEFAULT false,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_email ON staff_users(email) WHERE is_active = true;

COMMIT;
