import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { hash } from 'bcryptjs';
import { setupTestDb, testDbUrl } from '../helpers/db';

let pool: Pool;
let teardown: () => Promise<void>;
let createClosure: typeof import('../../lib/closures').createClosure;
let deleteClosure: typeof import('../../lib/closures').deleteClosure;
let listClosures: typeof import('../../lib/closures').listClosures;

async function makeAdmin(emailSuffix: string) {
  const passwordHash = await hash('AdminPass1234!', 10);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO staff_users (email, password_hash, role) VALUES ($1, $2, 'ADMIN') RETURNING id`,
    [`admin-${emailSuffix}@clinic.local`, passwordHash]
  );
  return r.rows[0].id;
}

function futureDate(daysOut: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  const db = await setupTestDb('closures');
  pool = db.pool;
  teardown = db.teardown;
  process.env.DATABASE_URL = testDbUrl();

  const mod = await import('../../lib/closures');
  createClosure = mod.createClosure;
  deleteClosure = mod.deleteClosure;
  listClosures = mod.listClosures;
}, 30_000);

afterAll(async () => { await teardown(); }, 15_000);

describe('createClosure', () => {
  it('creates a closure and writes an audit log entry', async () => {
    const adminId = await makeAdmin('create-1');
    const date = futureDate(10);
    const record = await createClosure(date, 'Public holiday', adminId, pool);

    expect(record.closure_date).toBe(date);
    expect(record.reason_public).toBe('Public holiday');
    expect(record.created_by).toBe(adminId);
    expect(record.deleted_at).toBeNull();

    const audit = await pool.query(
      `SELECT * FROM staff_audit_log WHERE actor_id = $1 AND action = 'CREATE' AND entity_type = 'clinic_closure'`,
      [adminId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].entity_id).toBe(date);
  });

  it('throws on duplicate date', async () => {
    const adminId = await makeAdmin('create-2');
    const date = futureDate(11);
    await createClosure(date, 'First closure', adminId, pool);
    await expect(createClosure(date, 'Second closure', adminId, pool)).rejects.toThrow();
  });
});

describe('deleteClosure', () => {
  it('soft-deletes a closure and writes an audit entry', async () => {
    const adminId = await makeAdmin('delete-1');
    const date = futureDate(20);
    await createClosure(date, 'To be deleted', adminId, pool);

    const deleted = await deleteClosure(date, adminId, pool);
    expect(deleted).toBe(true);

    const r = await pool.query(
      'SELECT deleted_at, deleted_by FROM clinic_closures WHERE closure_date = $1',
      [date]
    );
    expect(r.rows[0].deleted_at).not.toBeNull();
    expect(r.rows[0].deleted_by).toBe(adminId);

    const audit = await pool.query(
      `SELECT * FROM staff_audit_log WHERE actor_id = $1 AND action = 'DELETE'`,
      [adminId]
    );
    expect(audit.rows).toHaveLength(1);
  });

  it('returns false for a non-existent date', async () => {
    const adminId = await makeAdmin('delete-2');
    const result = await deleteClosure('2099-01-01', adminId, pool);
    expect(result).toBe(false);
  });

  it('returns false for an already-deleted closure', async () => {
    const adminId = await makeAdmin('delete-3');
    const date = futureDate(30);
    await createClosure(date, 'Delete twice', adminId, pool);
    await deleteClosure(date, adminId, pool);
    const second = await deleteClosure(date, adminId, pool);
    expect(second).toBe(false);
  });
});

describe('listClosures', () => {
  it('only returns non-deleted closures', async () => {
    const adminId = await makeAdmin('list-1');
    const dateA = futureDate(40);
    const dateB = futureDate(41);
    await createClosure(dateA, 'Active closure', adminId, pool);
    await createClosure(dateB, 'Deleted closure', adminId, pool);
    await deleteClosure(dateB, adminId, pool);

    const rows = await listClosures(pool);
    const dates = rows.map(r => r.closure_date);
    expect(dates).toContain(dateA);
    expect(dates).not.toContain(dateB);
  });
});
