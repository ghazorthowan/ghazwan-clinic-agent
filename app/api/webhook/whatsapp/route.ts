import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { verifySignature, normalizeInbound, newWindowExpiry, type MetaWebhookPayload } from '@/lib/whatsapp';

// ---------------------------------------------------------------------------
// GET — Meta webhook verification challenge
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
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

  if (messages.length > 0) {
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

        // Find or create conversation for this contact+channel
        await client.query(`
          INSERT INTO conversations (contact_id, channel)
          VALUES ($1, $2)
          ON CONFLICT (contact_id, channel) DO NOTHING
        `, [contactId, WA_CHANNEL]);

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

  // Meta expects 200 OK quickly; never return an error for delivery status updates
  return NextResponse.json({ status: 'ok' });
}
