/**
 * GET /api/health
 *
 * Public health check endpoint for uptime monitors and load balancers.
 * Returns 200 when the DB is reachable, 503 otherwise.
 * No authentication required — safe to expose publicly (no data returned).
 */

import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export async function GET() {
  try {
    const r = await pool.query<{ version: number }>(
      `SELECT max(version) AS version FROM schema_migrations`,
    );
    const schemaVersion = r.rows[0]?.version ?? 0;

    return NextResponse.json({
      ok: true,
      db: 'up',
      schemaVersion,
      ts: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { ok: false, db: 'down', ts: new Date().toISOString() },
      { status: 503 },
    );
  }
}
