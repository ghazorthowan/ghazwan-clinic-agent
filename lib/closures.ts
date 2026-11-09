import { Pool } from 'pg';
import { pool } from './db';

export interface ClosureRecord {
  closure_date: string;
  reason_public: string;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
}

export async function listClosures(db: Pool = pool): Promise<ClosureRecord[]> {
  const r = await db.query<ClosureRecord>(
    `SELECT closure_date::text, reason_public, created_by, created_at, deleted_at
     FROM clinic_closures
     WHERE deleted_at IS NULL
     ORDER BY closure_date`
  );
  return r.rows;
}

export async function createClosure(
  date: string,
  reasonPublic: string,
  actorId: string,
  db: Pool = pool
): Promise<ClosureRecord> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<ClosureRecord>(
      `INSERT INTO clinic_closures (closure_date, reason_public, created_by)
       VALUES ($1, $2, $3)
       RETURNING closure_date::text, reason_public, created_by, created_at, deleted_at`,
      [date, reasonPublic, actorId]
    );
    await client.query(
      `INSERT INTO staff_audit_log (actor_id, action, entity_type, entity_id, detail)
       VALUES ($1, 'CREATE', 'clinic_closure', $2, $3)`,
      [actorId, date, JSON.stringify({ reason_public: reasonPublic })]
    );
    await client.query('COMMIT');
    return r.rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function deleteClosure(
  date: string,
  actorId: string,
  db: Pool = pool
): Promise<boolean> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `UPDATE clinic_closures
       SET deleted_at = now(), deleted_by = $2
       WHERE closure_date = $1 AND deleted_at IS NULL`,
      [date, actorId]
    );
    if (r.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `INSERT INTO staff_audit_log (actor_id, action, entity_type, entity_id)
       VALUES ($1, 'DELETE', 'clinic_closure', $2)`,
      [actorId, date]
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
