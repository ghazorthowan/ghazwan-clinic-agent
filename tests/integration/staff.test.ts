import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { hash } from 'bcryptjs';
import { setupTestDb, testDbUrl } from '../helpers/db';

let pool: Pool;
let teardown: () => Promise<void>;

beforeAll(async () => {
  const db = await setupTestDb('staff_mgmt');
  pool = db.pool;
  teardown = db.teardown;
  process.env.DATABASE_URL = testDbUrl();
  process.env.STAFF_SESSION_SECRET = 'test-secret-must-be-at-least-32-chars-long!!';
}, 30_000);

afterAll(async () => { await teardown(); }, 15_000);

async function insertStaff(email: string, role = 'RECEPTIONIST', active = true) {
  const password_hash = await hash('Password1234!', 10);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO staff_users (email, password_hash, role, is_active) VALUES ($1, $2, $3, $4) RETURNING id`,
    [email, password_hash, role, active],
  );
  return r.rows[0].id;
}

describe('staff_users — RBAC and lifecycle', () => {
  it('admin role is stored correctly', async () => {
    const id = await insertStaff('admin@clinic.local', 'ADMIN');
    const r = await pool.query('SELECT role FROM staff_users WHERE id = $1', [id]);
    expect(r.rows[0].role).toBe('ADMIN');
  });

  it('receptionist role is stored correctly', async () => {
    const id = await insertStaff('rec@clinic.local', 'RECEPTIONIST');
    const r = await pool.query('SELECT role FROM staff_users WHERE id = $1', [id]);
    expect(r.rows[0].role).toBe('RECEPTIONIST');
  });

  it('rejects an invalid role', async () => {
    await expect(
      pool.query(
        `INSERT INTO staff_users (email, password_hash, role) VALUES ($1, $2, $3)`,
        ['badrole@clinic.local', 'hash', 'MANAGER'],
      ),
    ).rejects.toThrow();
  });

  it('deactivating a user sets is_active false', async () => {
    const id = await insertStaff('deactivate@clinic.local');
    await pool.query('UPDATE staff_users SET is_active = false WHERE id = $1', [id]);
    const r = await pool.query('SELECT is_active FROM staff_users WHERE id = $1', [id]);
    expect(r.rows[0].is_active).toBe(false);
  });

  it('reactivating a user sets is_active true', async () => {
    const id = await insertStaff('reactivate@clinic.local', 'RECEPTIONIST', false);
    await pool.query('UPDATE staff_users SET is_active = true WHERE id = $1', [id]);
    const r = await pool.query('SELECT is_active FROM staff_users WHERE id = $1', [id]);
    expect(r.rows[0].is_active).toBe(true);
  });

  it('changing role updates the role column', async () => {
    const id = await insertStaff('promote@clinic.local', 'RECEPTIONIST');
    await pool.query("UPDATE staff_users SET role = 'ADMIN' WHERE id = $1", [id]);
    const r = await pool.query('SELECT role FROM staff_users WHERE id = $1', [id]);
    expect(r.rows[0].role).toBe('ADMIN');
  });

  it('TOTP can be enabled with a secret', async () => {
    const id = await insertStaff('totp@clinic.local');
    const secret = 'JBSWY3DPEHPK3PXP';
    await pool.query(
      'UPDATE staff_users SET totp_secret = $1, totp_enabled = true WHERE id = $2',
      [secret, id],
    );
    const r = await pool.query('SELECT totp_enabled, totp_secret FROM staff_users WHERE id = $1', [id]);
    expect(r.rows[0].totp_enabled).toBe(true);
    expect(r.rows[0].totp_secret).toBe(secret);
  });
});

describe('staff_audit_log — auth events', () => {
  it('records a LOGIN event with STAFF actor', async () => {
    const staffId = await insertStaff('loginaudit@clinic.local');
    await pool.query(
      `INSERT INTO staff_audit_log (actor_id, actor_type, action, entity_type, entity_id)
       VALUES ($1, 'STAFF', 'LOGIN', 'staff_user', $2)`,
      [staffId, staffId],
    );
    const r = await pool.query(
      `SELECT actor_type, action FROM staff_audit_log WHERE actor_id = $1 AND action = 'LOGIN'`,
      [staffId],
    );
    expect(r.rows[0].actor_type).toBe('STAFF');
    expect(r.rows[0].action).toBe('LOGIN');
  });

  it('records a STAFF_DEACTIVATED event', async () => {
    const adminId = await insertStaff('adminaudit@clinic.local', 'ADMIN');
    const targetId = await insertStaff('target@clinic.local');
    await pool.query(
      `INSERT INTO staff_audit_log (actor_id, actor_type, action, entity_type, entity_id, detail)
       VALUES ($1, 'STAFF', 'STAFF_DEACTIVATED', 'staff_user', $2, $3)`,
      [adminId, targetId, JSON.stringify({ email: 'target@clinic.local' })],
    );
    const r = await pool.query(
      `SELECT action, detail FROM staff_audit_log WHERE entity_id = $1 AND action = 'STAFF_DEACTIVATED'`,
      [targetId],
    );
    expect(r.rows[0].action).toBe('STAFF_DEACTIVATED');
    expect(r.rows[0].detail.email).toBe('target@clinic.local');
  });
});
