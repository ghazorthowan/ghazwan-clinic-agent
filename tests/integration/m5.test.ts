/**
 * M5 integration tests: consent gate, right-to-forget, and health endpoint.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDb } from '../helpers/db';

let pool: Pool;
let teardown: () => Promise<void>;

let hasConsentFn: (contactId: string) => Promise<boolean>;
let recordConsentFn: (contactId: string, channel: string) => Promise<void>;
let eraseContactDataFn: (contactId: string) => Promise<void>;
let PRIVACY_NOTICE: string;
let ERASURE_CONFIRMATION: string;

let contactId: string;

beforeAll(async () => {
  ({ pool, teardown } = await setupTestDb('m5'));

  // Point lib/db.ts pool at the test DB (must happen before any module imports)
  process.env.DATABASE_URL = pool.options.connectionString as string;

  const consent = await import('../../lib/consent');
  hasConsentFn = consent.hasConsent;
  recordConsentFn = consent.recordConsent;
  eraseContactDataFn = consent.eraseContactData;
  PRIVACY_NOTICE = consent.PRIVACY_NOTICE;
  ERASURE_CONFIRMATION = consent.ERASURE_CONFIRMATION;

  // Insert a contact with no consent
  const r = await pool.query<{ id: string }>(`
    INSERT INTO contacts (phone, display_name, source_channel, external_contact_ref)
    VALUES ('+9647001000001', 'Test Patient', 'WA_01', 'test-ref-001')
    RETURNING id
  `);
  contactId = r.rows[0].id;
}, 30_000);

afterAll(async () => {
  await teardown();
}, 15_000);

// ── hasConsent ──────────────────────────────────────────────────────────────

describe('hasConsent', () => {
  it('returns false before consent is recorded', async () => {
    expect(await hasConsentFn(contactId)).toBe(false);
  });

  it('returns false for unknown contactId', async () => {
    expect(await hasConsentFn('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});

// ── recordConsent ───────────────────────────────────────────────────────────

describe('recordConsent', () => {
  it('sets consent_given_at', async () => {
    await recordConsentFn(contactId, 'WA_01');
    expect(await hasConsentFn(contactId)).toBe(true);
  });

  it('is idempotent — calling again does not throw', async () => {
    await expect(recordConsentFn(contactId, 'WA_01')).resolves.toBeUndefined();
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
    const r = await pool.query<{ id: string }>(`
      INSERT INTO contacts (phone, display_name, source_channel, external_contact_ref, consent_given_at)
      VALUES ('+9647001000002', 'Erase Me', 'WA_01', 'test-ref-002', now())
      RETURNING id
    `);
    eraseId = r.rows[0].id;
  });

  it('soft-erases PII fields', async () => {
    await eraseContactDataFn(eraseId);

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
    expect(await hasConsentFn(eraseId)).toBe(false);
  });

  it('is idempotent — second call does not throw', async () => {
    await expect(eraseContactDataFn(eraseId)).resolves.toBeUndefined();
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
    // DATABASE_URL already points at the test DB (set in beforeAll above).
    // The pool module is cached on globalThis — force a fresh import by
    // querying the route's pool directly via the already-imported pool.
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
