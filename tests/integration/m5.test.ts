/**
 * M5 integration tests: consent gate, right-to-forget, and health endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDb } from '../helpers/db';
import {
  hasConsent,
  recordConsent,
  eraseContactData,
  PRIVACY_NOTICE,
  ERASURE_CONFIRMATION,
} from '../../lib/consent';

let pool: Pool;
let teardown: () => Promise<void>;

// Seed a contact for use across tests
let contactId: string;

beforeAll(async () => {
  ({ pool, teardown } = await setupTestDb('m5'));

  // Insert a staff user (required for FK on conversations)
  await pool.query(`
    INSERT INTO staff_users (id, email, password_hash, role)
    VALUES (gen_random_uuid(), 'staff@test.com', 'x', 'ADMIN')
  `);

  // Insert a contact with no consent
  const r = await pool.query<{ id: string }>(`
    INSERT INTO contacts (phone, display_name, channel)
    VALUES ('+9647001000001', 'Test Patient', 'WA_01')
    RETURNING id
  `);
  contactId = r.rows[0].id;
});

afterAll(() => teardown());

// ── hasConsent ──────────────────────────────────────────────────────────────

describe('hasConsent', () => {
  it('returns false before consent is recorded', async () => {
    expect(await hasConsent(contactId)).toBe(false);
  });

  it('returns false for unknown contactId', async () => {
    expect(await hasConsent('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});

// ── recordConsent ───────────────────────────────────────────────────────────

describe('recordConsent', () => {
  it('sets consent_given_at', async () => {
    await recordConsent(contactId, 'WA_01');
    expect(await hasConsent(contactId)).toBe(true);
  });

  it('is idempotent — calling again does not throw', async () => {
    await expect(recordConsent(contactId, 'WA_01')).resolves.toBeUndefined();
  });

  it('stores channel in consent_ip column', async () => {
    const r = await pool.query<{ consent_ip: string }>(
      'SELECT consent_ip FROM contacts WHERE id = $1',
      [contactId],
    );
    expect(r.rows[0].consent_ip).toBe('WA_01');
  });
});

// ── eraseContactData ────────────────────────────────────────────────────────

describe('eraseContactData', () => {
  let eraseId: string;

  beforeAll(async () => {
    // Create a separate contact to erase so other tests are unaffected
    const r = await pool.query<{ id: string }>(`
      INSERT INTO contacts (phone, display_name, channel, consent_given_at)
      VALUES ('+9647001000002', 'Erase Me', 'WA_01', now())
      RETURNING id
    `);
    eraseId = r.rows[0].id;
  });

  it('soft-erases PII fields', async () => {
    await eraseContactData(eraseId);

    const r = await pool.query(
      'SELECT phone, display_name, consent_given_at, data_deleted_at FROM contacts WHERE id = $1',
      [eraseId],
    );
    const row = r.rows[0];
    expect(row.phone).toBeNull();
    expect(row.display_name).toBe('[deleted]');
    expect(row.consent_given_at).toBeNull();
    expect(row.data_deleted_at).not.toBeNull();
  });

  it('hasConsent returns false after erasure', async () => {
    expect(await hasConsent(eraseId)).toBe(false);
  });

  it('is idempotent — second call does not throw', async () => {
    await expect(eraseContactData(eraseId)).resolves.toBeUndefined();
  });
});

// ── PRIVACY_NOTICE + ERASURE_CONFIRMATION content ─────────────────────────

describe('PRIVACY_NOTICE', () => {
  it('contains Arabic text', () => {
    expect(PRIVACY_NOTICE).toMatch(/مرحباً/);
  });

  it('contains English text', () => {
    expect(PRIVACY_NOTICE).toMatch(/Welcome/);
  });

  it('mentions deletion instruction', () => {
    expect(PRIVACY_NOTICE).toMatch(/احذف بياناتي/);
    expect(PRIVACY_NOTICE).toMatch(/delete my data/i);
  });
});

describe('ERASURE_CONFIRMATION', () => {
  it('is bilingual', () => {
    expect(ERASURE_CONFIRMATION).toMatch(/تم حذف/);
    expect(ERASURE_CONFIRMATION).toMatch(/erased/i);
  });
});

// ── schema_migrations table ─────────────────────────────────────────────────

describe('schema_migrations', () => {
  it('has 12 versions after all migrations run', async () => {
    const r = await pool.query<{ count: string }>(
      'SELECT count(*) FROM schema_migrations',
    );
    expect(Number(r.rows[0].count)).toBe(12);
  });

  it('max version is 12', async () => {
    const r = await pool.query<{ version: number }>(
      'SELECT max(version) AS version FROM schema_migrations',
    );
    expect(r.rows[0].version).toBe(12);
  });
});

// ── /api/health route ────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with schema version when DB is up', async () => {
    // We test the handler directly by importing and calling it in-process.
    // The route queries the real DB via the pool module; we patch DATABASE_URL
    // to point at our test DB.
    process.env.DATABASE_URL = process.env.TEST_DB_NAME
      ? `postgresql://clinic:clinic_dev_only@localhost:5432/${process.env.TEST_DB_NAME}`
      : process.env.DATABASE_URL;

    // Lazy import so the pool picks up the patched env
    const { GET } = await import('../../app/api/health/route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.db).toBe('up');
    expect(body.schemaVersion).toBe(12);
    expect(typeof body.ts).toBe('string');
  });
});
