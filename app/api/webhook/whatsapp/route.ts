import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { verifySignature, normalizeInbound, normalizeStatuses, newWindowExpiry, type MetaWebhookPayload } from '@/lib/whatsapp';
import { webhookLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';

// ---------------------------------------------------------------------------
// Internal helper — calls /api/ai/respond for each conversation.
// Fire-and-forget: errors are logged but never bubble up to the webhook caller.
// ---------------------------------------------------------------------------

function triggerAIRespond(req: NextRequest, conversationIds: string[]): void {
  if (!conversationIds.length) return;

  const base = new URL(req.url).origin;
  const secret = process.env.INTERNAL_API_SECRET;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['x-internal-secret'] = secret;

  for (const conversationId of conversationIds) {
    fetch(`${base}/api/ai/respond`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ conversationId }),
    }).catch((err: unknown) => {
      console.error(`AI respond error for conversation ${conversationId}:`, err);
    });
  }
}

// ---------------------------------------------------------------------------
// GET — Meta webhook verification challenge
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — inbound messages
// ---------------------------------------------------------------------------

const WA_CHANNEL = 'WA_01';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { limited, retryAfter } = await checkRateLimit(webhookLimiter, `webhook:${ip}`);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-hub-signature-256');

  if (!verifySignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const messages = normalizeInbound(payload);
  const statuses = normalizeStatuses(payload);

  const conversationIds: string[] = [];

  if (messages.length > 0 || statuses.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const msg of messages) {
        // Upsert contact — keyed by (source_channel, external_contact_ref)
        const contactResult = await client.query<{ id: string }>(`
          INSERT INTO contacts (display_name, phone, source_channel, external_contact_ref)
          VALUES ($1, $2, $3, $2)
          ON CONFLICT (source_channel, external_contact_ref)
            DO UPDATE SET display_name = EXCLUDED.display_name
          RETURNING id
        `, [msg.displayName, msg.fromPhone, WA_CHANNEL]);
        const contactId = contactResult.rows[0].id;

        // Find or create conversation for this contact+channel, storing the phone_number_id
        await client.query(`
          INSERT INTO conversations (contact_id, channel, phone_number_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (contact_id, channel)
            DO UPDATE SET phone_number_id = EXCLUDED.phone_number_id
        `, [contactId, WA_CHANNEL, msg.phoneNumberId]);

        const convResult = await client.query<{ id: string }>(`
          SELECT id FROM conversations WHERE contact_id = $1 AND channel = $2 LIMIT 1
        `, [contactId, WA_CHANNEL]);
        const conversationId = convResult.rows[0].id;

        // Update the 24-hour messaging window
        await client.query(`
          UPDATE conversations
          SET window_expires_at = $1
          WHERE id = $2
        `, [newWindowExpiry(msg.providerTimestamp), conversationId]);

        // Insert message — idempotent via partial unique index on provider_message_id
        await client.query(`
          INSERT INTO messages (conversation_id, direction, body, provider_message_id, provider_timestamp)
          VALUES ($1, 'IN', $2, $3, $4)
          ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
          DO NOTHING
        `, [conversationId, msg.body, msg.providerMessageId, msg.providerTimestamp]);

        conversationIds.push(conversationId);
      }

      // Mark outbound messages as delivered — informational, never blocks inbound processing.
      for (const s of statuses) {
        if (s.status === 'delivered' || s.status === 'read') {
          await client.query(
            `UPDATE messages SET delivered_at = $1
             WHERE provider_message_id = $2 AND delivered_at IS NULL`,
            [new Date(Number(s.timestamp) * 1000), s.id],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('WhatsApp webhook DB error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    } finally {
      client.release();
    }
  }

  // Fire-and-forget: trigger AI response for each conversation after the
  // transaction commits. Done outside the transaction so Meta gets 200 fast.
  triggerAIRespond(req, conversationIds);

  // Meta expects 200 OK quickly; never return an error for delivery status updates
  return NextResponse.json({ status: 'ok' });
}
