import { Pool } from 'pg';
import { hash } from 'bcryptjs';

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@clinic.local';
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword || adminPassword.length < 12) {
    throw new Error('Set ADMIN_PASSWORD (min 12 chars) in .env.local before running this script');
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const passwordHash = await hash(adminPassword, 12);
    const r = await pool.query<{ id: string }>(
      `INSERT INTO staff_users (email, password_hash, role)
       VALUES ($1, $2, 'ADMIN')
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'ADMIN', updated_at = now()
       RETURNING id`,
      [adminEmail, passwordHash]
    );
    console.log(`Admin account ready: ${adminEmail} (id: ${r.rows[0].id})`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
