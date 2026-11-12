/**
 * POST /api/webhook/meta
 *
 * Unified webhook for Instagram Business and Facebook Messenger.
 * Both arrive through the same Facebook App and share META_APP_SECRET for
 * HMAC-SHA256 verification. The payload `object` field distinguishes channels.
 *
 * CLAUDE.md rule 2: Requires a Facebook App with approved Instagram / Messenger
 * products — credentials must be separately obtained from Meta Business Manager.
 * CLAUDE.md rule 8: Do not connect third-party accounts without explicit approval.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import {
  verifyMetaSignature,
  normalizeInstagram,
  normalizeMessenger,
  type MetaSocialPayload,
} from '@/lib/meta';
import { webhookLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';

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

  const verifyToken = process.env.META_VERIFY_TOKEN;
  if (!verifyToken) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// ---------------------------------------------------------------------------
// POST — inbound Instagram and Messenger messages
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { limited, retryAfter } = await checkRateLimit(webhookLimiter, `meta-webhook:${ip}`);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  const rawBody = Buffer.from(await req.arrayBuffer());
  const signature = req.headers.get('x-hub-signature-256');

  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: MetaSocialPayload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const messages =
    payload.object === 'instagram' ? normalizeInstagram(payload) :
    payload.object === 'page'      ? normalizeMessenger(payload) :
    [];

  const conversationIds: string[] = [];

  if (messages.length > 0) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const msg of messages) {
        // Upsert contact — no phone for IG/Messenger, keyed by (channel, senderId)
        const contactResult = await client.query<{ id: string }>(`
          INSERT INTO contacts (display_name, source_channel, external_contact_ref)
          VALUES ($1, $2, $3)
          ON CONFLICT (source_channel, external_contact_ref)
            DO UPDATE SET display_name = EXCLUDED.display_name
          RETURNING id
        `, [msg.senderId, msg.channel, msg.senderId]);
        const contactId = contactResult.rows[0].id;

        // Find or create conversation
        await client.query(`
          INSERT INTO conversations (contact_id, channel)
          VALUES ($1, $2)
          ON CONFLICT (contact_id, channel) DO NOTHING
        `, [contactId, msg.channel]);

        const convResult = await client.query<{ id: string }>(
          `SELECT id FROM conversations WHERE contact_id = $1 AND channel = $2 LIMIT 1`,
          [contactId, msg.channel],
        );
        const conversationId = convResult.rows[0].id;

        // Insert message — idempotent via partial unique index on provider_message_id
        await client.query(`
          INSERT INTO messages (conversation_id, direction, body, provider_message_id, provider_timestamp)
          VALUES ($1, 'IN', $2, $3, $4)
          ON CONFLICT (provider_message_id) WHERE provider_message_id IS NOT NULL
          DO NOTHING
        `, [conversationId, msg.body, msg.providerMessageId, msg.providerTimestamp]);

        conversationIds.push(conversationId);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Meta webhook DB error:', err);
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    } finally {
      client.release();
    }
  }

  triggerAIRespond(req, conversationIds);
  return NextResponse.json({ status: 'ok' });
}
