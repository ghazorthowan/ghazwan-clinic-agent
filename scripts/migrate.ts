import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const file of ['001_init.sql', '002_staff_auth.sql', '003_staff_lockout.sql', '004_audit_log.sql', '005_whatsapp_webhook.sql']) {
      const sql = readFileSync(join(process.cwd(), 'db', file), 'utf8');
      await pool.query(sql);
      console.log(`Applied ${file}`);
    }
    console.log('Database schema ready');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
