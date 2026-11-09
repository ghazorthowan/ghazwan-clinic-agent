import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { hash, compare } from 'bcryptjs';
import { setupTestDb, testDbUrl } from '../helpers/db';

let pool: Pool;
let teardown: () => Promise<void>;

beforeAll(async () => {
  const db = await setupTestDb('auth');
  pool = db.pool;
  teardown = db.teardown;
  process.env.DATABASE_URL = testDbUrl();
}, 30_000);

afterAll(async () => { await teardown(); }, 15_000);

async function createUser(email: string, password: string, role = 'RECEPTIONIST') {
  const password_hash = await hash(password, 10);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO staff_users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id`,
    [email, password_hash, role]
  );
  return r.rows[0].id;
}

describe('staff_users table', () => {
  it('creates a staff account and verifies password', async () => {
    await createUser('receptionist@clinic.local', 'Password1234!');
    const r = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM staff_users WHERE email = $1',
      ['receptionist@clinic.local']
    );
    expect(await compare('Password1234!', r.rows[0].password_hash)).toBe(true);
    expect(await compare('wrong', r.rows[0].password_hash)).toBe(false);
  });

  it('defaults role to RECEPTIONIST and is_active to true', async () => {
    await createUser('rec2@clinic.local', 'Password1234!');
    const r = await pool.query(
      'SELECT role, is_active, totp_enabled FROM staff_users WHERE email = $1',
      ['rec2@clinic.local']
    );
    expect(r.rows[0].role).toBe('RECEPTIONIST');
    expect(r.rows[0].is_active).toBe(true);
    expect(r.rows[0].totp_enabled).toBe(false);
  });

  it('enforces unique email', async () => {
    await createUser('unique@clinic.local', 'Password1234!');
    await expect(createUser('unique@clinic.local', 'OtherPass5678!')).rejects.toThrow();
  });

  it('tracks failed_attempts and locks account', async () => {
    const id = await createUser('lockme@clinic.local', 'Password1234!');
    const lockUntil = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      'UPDATE staff_users SET failed_attempts = 10, locked_until = $1 WHERE id = $2',
      [lockUntil, id]
    );
    const r = await pool.query<{ locked_until: Date; failed_attempts: number }>(
      'SELECT failed_attempts, locked_until FROM staff_users WHERE id = $1',
      [id]
    );
    expect(r.rows[0].failed_attempts).toBe(10);
    expect(new Date(r.rows[0].locked_until) > new Date()).toBe(true);
  });

  it('unlocks account by resetting failed_attempts and locked_until', async () => {
    const id = await createUser('unlock@clinic.local', 'Password1234!');
    await pool.query(
      "UPDATE staff_users SET failed_attempts = 10, locked_until = now() + interval '1 hour' WHERE id = $1",
      [id]
    );
    await pool.query(
      'UPDATE staff_users SET failed_attempts = 0, locked_until = NULL WHERE id = $1',
      [id]
    );
    const r = await pool.query<{ locked_until: null; failed_attempts: number }>(
      'SELECT failed_attempts, locked_until FROM staff_users WHERE id = $1',
      [id]
    );
    expect(r.rows[0].failed_attempts).toBe(0);
    expect(r.rows[0].locked_until).toBeNull();
  });

  it('deactivating a staff account sets is_active false', async () => {
    const id = await createUser('deactivate@clinic.local', 'Password1234!');
    await pool.query('UPDATE staff_users SET is_active = false WHERE id = $1', [id]);
    const r = await pool.query('SELECT is_active FROM staff_users WHERE id = $1', [id]);
    expect(r.rows[0].is_active).toBe(false);
  });
});
