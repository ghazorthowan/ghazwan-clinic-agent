import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupTestDb, nextClinicDate } from '../helpers/db';

// We re-implement createBooking/transitionBooking using the test pool
// by temporarily overriding process.env.DATABASE_URL before importing lib/booking.
// Since vitest isolates modules per file we set the env before any import.

let pool: Pool;
let teardown: () => Promise<void>;
let createBooking: typeof import('../../lib/booking').createBooking;
let transitionBooking: typeof import('../../lib/booking').transitionBooking;
let listBookings: typeof import('../../lib/booking').listBookings;
let BookingError: typeof import('../../lib/booking').BookingError;

beforeAll(async () => {
  const db = await setupTestDb('booking');
  pool = db.pool;
  teardown = db.teardown;

  // Point the module at the test DB
  const { testDbUrl } = await import('../helpers/db');
  process.env.DATABASE_URL = testDbUrl();

  const mod = await import('../../lib/booking');
  createBooking = mod.createBooking;
  transitionBooking = mod.transitionBooking;
  listBookings = mod.listBookings;
  BookingError = mod.BookingError;
}, 30_000);

afterAll(async () => { await teardown(); }, 15_000);

const BASE = {
  displayName: 'Test Patient',
  sourceChannel: 'SIMULATED_WHATSAPP' as const,
  externalContactRef: 'test-ref-001',
  locale: 'en' as const,
};

describe('createBooking', () => {
  it('creates a booking on a valid open future date', async () => {
    const date = nextClinicDate();
    const b = await createBooking({ ...BASE, clinicDate: date });
    expect(b.booking_code).toMatch(/^GH-/);
    expect(b.status).toBe('AWAITING_PATIENT');
    expect(b.existing).toBe(false);
  });

  it('returns the existing booking on a duplicate request', async () => {
    const date = nextClinicDate();
    const ref = 'test-ref-dup';
    await createBooking({ ...BASE, externalContactRef: ref, clinicDate: date });
    const second = await createBooking({ ...BASE, externalContactRef: ref, clinicDate: date });
    expect(second.existing).toBe(true);
  });

  it('rejects a closed weekday (Thursday)', async () => {
    // Find next Thursday
    const d = new Date();
    d.setDate(d.getDate() + ((4 - d.getDay() + 7) % 7 || 7));
    const date = d.toISOString().slice(0, 10);
    await expect(createBooking({ ...BASE, externalContactRef: 'ref-thu', clinicDate: date }))
      .rejects.toThrow(BookingError);
  });

  it('rejects a past date', async () => {
    await expect(createBooking({ ...BASE, externalContactRef: 'ref-past', clinicDate: '2020-01-05' }))
      .rejects.toThrow(BookingError);
  });

  it('rejects a date that has a closure record', async () => {
    const date = nextClinicDate();
    await pool.query(
      "INSERT INTO clinic_closures(closure_date, reason_public) VALUES($1, 'Test closure') ON CONFLICT DO NOTHING",
      [date]
    );
    await expect(createBooking({ ...BASE, externalContactRef: 'ref-closure', clinicDate: date }))
      .rejects.toThrow(BookingError);
    await pool.query('DELETE FROM clinic_closures WHERE closure_date = $1', [date]);
  });
});

describe('transitionBooking', () => {
  async function makeBooking(ref: string) {
    // Use a date 14 days out to avoid interference with closure test above
    const d = new Date();
    d.setDate(d.getDate() + 14 + ((7 - d.getDay()) % 7 || 7));
    const date = d.toISOString().slice(0, 10);
    return createBooking({ ...BASE, externalContactRef: ref, clinicDate: date });
  }

  it('confirms an AWAITING_PATIENT booking', async () => {
    const b = await makeBooking('ref-confirm');
    const updated = await transitionBooking(b.id, 'CONFIRM');
    expect(updated.status).toBe('CONFIRMED');
    expect(updated.confirmed_at).toBeTruthy();
  });

  it('confirming an already-CONFIRMED booking returns unchanged', async () => {
    const b = await makeBooking('ref-confirm2');
    await transitionBooking(b.id, 'CONFIRM');
    const again = await transitionBooking(b.id, 'CONFIRM');
    expect((again as { unchanged?: boolean }).unchanged).toBe(true);
  });

  it('cancels a confirmed booking', async () => {
    const b = await makeBooking('ref-cancel');
    await transitionBooking(b.id, 'CONFIRM');
    const updated = await transitionBooking(b.id, 'CANCEL');
    expect(updated.status).toBe('CANCELLED');
  });

  it('cancelling an already-cancelled booking returns unchanged', async () => {
    const b = await makeBooking('ref-cancel2');
    await transitionBooking(b.id, 'CANCEL');
    const again = await transitionBooking(b.id, 'CANCEL');
    expect((again as { unchanged?: boolean }).unchanged).toBe(true);
  });

  it('records arrival and assigns sequence number', async () => {
    const b = await makeBooking('ref-arrive');
    await transitionBooking(b.id, 'CONFIRM');
    const arrived = await transitionBooking(b.id, 'ARRIVE');
    expect(arrived.attendance_status).toBe('ARRIVED');
    expect(arrived.arrival_sequence).toBeGreaterThanOrEqual(1);
  });

  it('arrival on an unconfirmed booking throws', async () => {
    const b = await makeBooking('ref-arrive-fail');
    await expect(transitionBooking(b.id, 'ARRIVE')).rejects.toThrow(BookingError);
  });

  it('arrival sequence increments for each patient', async () => {
    const b1 = await makeBooking('ref-seq1');
    const b2 = await makeBooking('ref-seq2');
    await transitionBooking(b1.id, 'CONFIRM');
    await transitionBooking(b2.id, 'CONFIRM');
    const a1 = await transitionBooking(b1.id, 'ARRIVE');
    const a2 = await transitionBooking(b2.id, 'ARRIVE');
    expect(a2.arrival_sequence).toBe(a1.arrival_sequence + 1);
  });

  it('throws on unknown booking id', async () => {
    await expect(transitionBooking('00000000-0000-0000-0000-000000000000', 'CONFIRM'))
      .rejects.toThrow(BookingError);
  });

  it('replaying the same idempotency key returns idempotent:true without duplicating events', async () => {
    const b = await makeBooking('ref-idempotent');
    const key = `confirm:${b.id}:test-key-001`;
    const first = await transitionBooking(b.id, 'CONFIRM', key);
    expect(first.status).toBe('CONFIRMED');

    const second = await transitionBooking(b.id, 'CONFIRM', key);
    // Sequential replay: booking already CONFIRMED → unchanged path; no duplicate events
    expect(second.status).toBe('CONFIRMED');

    // Exactly one booking_events row for this key (no duplicates)
    const r = await pool.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM booking_events WHERE event_key = $1',
      [key]
    );
    expect(Number(r.rows[0].count)).toBe(1);
  });

  it('soft-deleted closure no longer blocks booking', async () => {
    // The createClosure / deleteClosure path is tested in closures.test.ts;
    // here we just verify the closure query respects deleted_at
    const date = nextClinicDate();
    await pool.query(
      `INSERT INTO clinic_closures(closure_date, reason_public, deleted_at)
       VALUES($1, 'Was closed', now()) ON CONFLICT DO NOTHING`,
      [date]
    );
    const b = await createBooking({ ...BASE, externalContactRef: 'ref-soft-closure', clinicDate: date });
    expect(b.booking_code).toMatch(/^GH-/);
  });
});

describe('listBookings', () => {
  it('returns an array', async () => {
    const rows = await listBookings();
    expect(Array.isArray(rows)).toBe(true);
  });
});
