/**
 * Append-only audit logger.
 *
 * Writes to staff_audit_log. Never throws — audit failures are logged to
 * stderr but must never break the caller's primary operation.
 *
 * actor_type:
 *   STAFF  — a human staff member (actor_id = staff_users.id)
 *   AI     — the Claude AI engine (actor_id = null)
 *   SYSTEM — background jobs, migrations, cron (actor_id = null)
 */

import { pool } from './db';
import type { PoolClient } from 'pg';

export type ActorType = 'STAFF' | 'AI' | 'SYSTEM';

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;        // staff_users.id for STAFF; null for AI/SYSTEM
  action: string;                 // past-tense verb, e.g. 'BOOKING_CANCELLED'
  entityType: string;             // 'booking' | 'conversation' | 'contact' | …
  entityId: string;
  detail?: Record<string, unknown>;
  client?: PoolClient;            // pass to participate in an existing transaction
}

export async function audit(entry: AuditEntry): Promise<void> {
  const { actorType, actorId, action, entityType, entityId, detail, client: c } = entry;

  const sql = `
    INSERT INTO staff_audit_log (actor_id, actor_type, action, entity_type, entity_id, detail)
    VALUES ($1, $2, $3, $4, $5, $6)
  `;
  const params = [
    actorId ?? null,
    actorType,
    action,
    entityType,
    entityId,
    detail ? JSON.stringify(detail) : null,
  ];

  try {
    if (c) {
      await c.query(sql, params);
    } else {
      await pool.query(sql, params);
    }
  } catch (err) {
    // Audit must not break primary operations.
    console.error('[audit] failed to write entry:', action, entityType, entityId, err);
  }
}

/** Convenience: log an AI tool dispatch. */
export function auditAI(
  action: string,
  entityType: string,
  entityId: string,
  detail?: Record<string, unknown>,
  client?: PoolClient,
): Promise<void> {
  return audit({ actorType: 'AI', actorId: null, action, entityType, entityId, detail, client });
}
