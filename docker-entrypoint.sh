#!/bin/sh
set -e

# ── Run migrations ────────────────────────────────────────────────────────────
echo "[entrypoint] Running database migrations..."
npm run db:migrate

# ── Seed admin account (only on first boot) ───────────────────────────────────
# If ADMIN_EMAIL and ADMIN_PASSWORD are set and no staff users exist yet,
# seed the first admin account. Safe to leave set — the script is idempotent.
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
  echo "[entrypoint] Seeding admin account (skipped if already exists)..."
  npm run db:seed-admin || echo "[entrypoint] seed-admin skipped or already done"
fi

# ── Start Next.js ─────────────────────────────────────────────────────────────
echo "[entrypoint] Starting Next.js on port ${PORT:-3000}..."
exec node server.js
