import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.DATABASE_URL ?? 'postgresql://clinic:clinic_dev_only@localhost:5432/clinic_booking';

/** Build a unique test DB name from the calling file's basename + a random suffix */
function uniqueTestDb(label = 'test'): string {
  return `clinic_test_${label}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Connection string pointing at a given database name */
export function testDbUrl(dbName?: string): string {
  const name = dbName ?? (process.env.TEST_DB_NAME ?? 'clinic_booking_test');
  return BASE_URL.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);
}

/** Create a fresh test database, run all migrations, return a pool. Call teardown() in afterAll. */
export async function setupTestDb(label = 'db'): Promise<{ pool: Pool; teardown: () => Promise<void> }> {
  const dbName = uniqueTestDb(label);

  // Connect to the default DB to CREATE the test DB
  const admin = new Pool({ connectionString: BASE_URL });
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();

  const url = testDbUrl(dbName);
  const pool = new Pool({ connectionString: url, max: 5 });

  for (const file of [
    '001_init.sql',
    '002_staff_auth.sql',
    '003_staff_lockout.sql',
    '004_audit_log.sql',
    '005_whatsapp_webhook.sql',
    '006_outbox.sql',
    '007_audit_actor_type.sql',
    '008_rate_limit.sql',
  ]) {
    const sql = readFileSync(join(process.cwd(), 'db', file), 'utf8');
    await pool.query(sql);
  }

  // Expose url so tests can point their module imports at it
  process.env.TEST_DB_NAME = dbName;

  return {
    pool,
    teardown: async () => {
      // Swallow late disconnect errors emitted by pg when we terminate connections
      pool.on('error', () => {});
      const suppress = () => {};
      process.on('uncaughtException', suppress);
      await pool.end().catch(() => {});
      // Give sockets a tick to drain before dropping the DB
      await new Promise(r => setTimeout(r, 100));
      const admin2 = new Pool({ connectionString: BASE_URL });
      // Terminate remaining connections so DROP DATABASE succeeds
      await admin2.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName]
      );
      await admin2.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await admin2.end();
    },
  };
}

/** Return an open future clinic date (next Sunday). */
export function nextClinicDate(): string {
  const d = new Date();
  // Find the next Sunday (day 0)
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
