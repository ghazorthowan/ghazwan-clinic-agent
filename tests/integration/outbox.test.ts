import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDb, testDbUrl, nextClinicDate } from '../helpers/db';

let pool: Pool;
let teardown: () => Promise<void>;
let drainOutbox: typeof import('../../lib/sheets').drainOutbox;
let createBooking: typeof import('../../lib/booking').createBooking;
let transitionBooking: typeof import('../../lib/booking').transitionBooking;

const BASE = {
  displayName: 'Outbox Patient',
  sourceChannel: 'SIMULATED_WHATSAPP' as const,
  locale: 'en' as const,
};

beforeAll(async () => {
  const db = await setupTestDb('outbox');
  pool = db.pool;
  teardown = db.teardown;
  process.env.DATABASE_URL = testDbUrl();

  const bookingMod = await import('../../lib/booking');
  createBooking = bookingMod.createBooking;
  transitionBooking = bookingMod.transitionBooking;

  const sheetsMod = await import('../../lib/sheets');
  drainOutbox = sheetsMod.drainOutbox;
}, 30_000);

afterAll(async () => { await teardown(); }, 15_000);

async function pendingOutboxIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    'SELECT id FROM sync_outbox WHERE synced_at IS NULL ORDER BY id',
  );
  return r.rows.map(row => row.id);
}

async function syncedOutboxIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    'SELECT id FROM sync_outbox WHERE synced_at IS NOT NULL ORDER BY id',
  );
  return r.rows.map(row => row.id);
}

describe('drainOutbox', () => {
  it('marks pending rows synced after a successful doSync call', async () => {
    const date = nextClinicDate();
    await createBooking({ ...BASE, externalContactRef: 'ob-ref-1', clinicDate: date });

    const before = await pendingOutboxIds();
    expect(before.length).toBeGreaterThan(0);

    const synced: unknown[] = [];
    const result = await drainOutbox(async rows => { synced.push(...rows); }, pool);

    expect(result.synced).toBeGreaterThan(0);
    expect(synced.length).toBeGreaterThan(0);
    expect(await pendingOutboxIds()).toHaveLength(0);
  });

  it('rows inserted during doSync stay pending for the next run', async () => {
    const date = nextClinicDate();
    // Create a booking to seed at least one pending row
    await createBooking({ ...BASE, externalContactRef: 'ob-ref-race-seed', clinicDate: date });

    let newBookingId: string | undefined;
    const result = await drainOutbox(async () => {
      // Simulate a new booking arriving while sync is in-flight
      const b = await createBooking({ ...BASE, externalContactRef: 'ob-ref-race-new', clinicDate: date });
      newBookingId = b.id;
    }, pool);

    expect(result.synced).toBeGreaterThan(0);

    // The new booking's outbox row should still be pending
    const r = await pool.query<{ synced_at: Date | null }>(
      'SELECT synced_at FROM sync_outbox WHERE booking_id = $1 ORDER BY id DESC LIMIT 1',
      [newBookingId],
    );
    expect(r.rows[0]?.synced_at).toBeNull();
  });

  it('records error on each pending row when doSync throws', async () => {
    const date = nextClinicDate();
    await createBooking({ ...BASE, externalContactRef: 'ob-ref-fail', clinicDate: date });

    const beforeIds = await pendingOutboxIds();
    expect(beforeIds.length).toBeGreaterThan(0);

    await expect(
      drainOutbox(async () => { throw new Error('Sheets API unavailable'); }, pool),
    ).rejects.toThrow('Sheets API unavailable');

    // All previously-pending rows should now carry an error message
    const r = await pool.query<{ error: string | null; synced_at: Date | null }>(
      'SELECT error, synced_at FROM sync_outbox WHERE id = ANY($1)',
      [beforeIds],
    );
    for (const row of r.rows) {
      expect(row.error).toMatch(/Sheets API unavailable/);
      // Errored rows remain pending (synced_at IS NULL) so the next run retries them
      expect(row.synced_at).toBeNull();
    }
  });

  it('returns skipped when nothing is pending', async () => {
    // Drain any leftover rows (including errored ones from the previous test) with a
    // successful no-op so the outbox is clean, then verify the second call skips.
    await drainOutbox(async () => {}, pool);
    const result = await drainOutbox(async () => {}, pool);
    expect(result.skipped).toBe('nothing pending');
  });

  it('returns skipped when advisory lock is held', async () => {
    const LOCK_KEY = 777_001;
    const blocker = await pool.connect();
    await blocker.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);

    try {
      const date = nextClinicDate();
      await createBooking({ ...BASE, externalContactRef: 'ob-ref-lock', clinicDate: date });
      const result = await drainOutbox(async () => {}, pool);
      expect(result.skipped).toBe('sync already running');
    } finally {
      await blocker.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      blocker.release();
    }
  });
});
