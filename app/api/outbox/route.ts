/**
 * POST /api/outbox
 *
 * Outbox worker — picks unsent OUT messages and delivers them via the
 * Meta WhatsApp Cloud API. Safe to call on a cron schedule (every 30s–1min).
 *
 * Idempotent: each row is claimed with a SELECT … FOR UPDATE SKIP LOCKED
 * so concurrent invocations never double-send.
 *
 * Retry policy:
 *   - Up to MAX_ATTEMPTS total (including the first try)
 *   - Permanent failure (4xx from Meta): no further retries
 *   - Transient failure (5xx / network): retried on next invocation
 *
 * Protected by INTERNAL_API_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { sendWhatsAppMessage, SendError } from '@/lib/whatsapp-send';

const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 3;

interface OutboxRow {
  id: string;
  conversation_id: string;
  body: string;
  phone_number_id: string | null;
  send_attempts: number;
  to_phone: string;
}

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret) {
    const auth = req.headers.get('x-internal-secret');
    if (auth !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const client = await pool.connect();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  try {
    // Claim a batch of unsent OUT rows, joining contacts to get the recipient phone.
    // SKIP LOCKED means concurrent workers never fight over the same row.
    const rows = await client.query<OutboxRow>(`
      SELECT
        m.id,
        m.conversation_id,
        m.body,
        m.phone_number_id,
        m.send_attempts,
        c.phone AS to_phone
      FROM messages m
      JOIN conversations conv ON conv.id = m.conversation_id
      JOIN contacts c ON c.id = conv.contact_id
      WHERE m.direction = 'OUT'
        AND m.sent_at IS NULL
        AND m.send_attempts < $1
      ORDER BY m.created_at
      LIMIT $2
      FOR UPDATE OF m SKIP LOCKED
    `, [MAX_ATTEMPTS, BATCH_SIZE]);

    for (const row of rows.rows) {
      // Simulated contacts have no real phone — skip silently.
      if (!row.phone_number_id || row.to_phone.startsWith('sim:')) {
        await client.query(
          `UPDATE messages SET sent_at = NOW(), send_attempts = send_attempts + 1 WHERE id = $1`,
          [row.id],
        );
        skipped++;
        continue;
      }

      try {
        const result = await sendWhatsAppMessage(
          row.phone_number_id,
          row.to_phone,
          row.body,
        );

        await client.query(`
          UPDATE messages
          SET sent_at = NOW(),
              send_attempts = send_attempts + 1,
              provider_message_id = COALESCE($2, provider_message_id),
              last_error = NULL
          WHERE id = $1
        `, [row.id, result.providerMessageId]);

        if (result.simulated) skipped++; else sent++;
      } catch (err) {
        const isPermanent = err instanceof SendError && (err.statusCode ?? 0) >= 400 && (err.statusCode ?? 0) < 500;
        const newAttempts = row.send_attempts + 1;

        await client.query(`
          UPDATE messages
          SET send_attempts = $2,
              last_error = $3,
              sent_at = CASE WHEN $4 THEN NOW() ELSE NULL END
          WHERE id = $1
        `, [row.id, newAttempts, String(err), isPermanent]);

        console.error(`Outbox send error (msg ${row.id}, attempt ${newAttempts}):`, err);
        failed++;
      }
    }
  } finally {
    client.release();
  }

  return NextResponse.json({ sent, failed, skipped });
}
