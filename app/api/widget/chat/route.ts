/**
 * POST /api/widget/chat
 *
 * Public-facing chat endpoint for the Wix-embeddable clinic widget.
 * No authentication required — the widget is an anonymous public channel.
 *
 * Security controls:
 *   - Origin must be in WIDGET_ALLOWED_ORIGINS (comma-separated, required in production)
 *   - DB-backed rate limit per IP via mutationLimiter
 *   - Session isolation via client-generated sessionId (UUID recommended)
 *
 * Flow:
 *   1. Store the inbound message (channel = WIX, external ref = sessionId)
 *   2. Run the AI engine synchronously
 *   3. Store and return the AI reply
 *
 * CLAUDE.md rule 1: Fictional fixtures only until privacy + clinical-safety gates approved.
 * CLAUDE.md rule 6: AI actions use validated allow-listed tools only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { pool } from '@/lib/db';
import { generateResponse } from '@/lib/ai';
import { mutationLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';
import type Anthropic from '@anthropic-ai/sdk';

const WIDGET_CHANNEL = 'WIX' as const;

const bodySchema = z.object({
  sessionId: z.string().min(1).max(128),
  message: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// Origin enforcement
// ---------------------------------------------------------------------------

function isAllowedOrigin(origin: string | null): boolean {
  const rawAllowed = process.env.WIDGET_ALLOWED_ORIGINS ?? '';
  const allowed = rawAllowed.split(',').map(o => o.trim()).filter(Boolean);
  // No allow-list configured → permissive (useful for local dev + tests).
  // Set WIDGET_ALLOWED_ORIGINS in production to restrict to your Wix domain(s).
  if (allowed.length === 0) return true;
  return origin !== null && allowed.includes(origin);
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

// ---------------------------------------------------------------------------
// POST — receive message, run AI, return reply
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  if (!isAllowedOrigin(origin)) {
    return NextResponse.json({ error: 'Origin not allowed' }, { status: 403 });
  }

  const ip = getClientIp(req);
  const { limited, retryAfter } = await checkRateLimit(mutationLimiter, `widget:${ip}`);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter), ...corsHeaders(origin) } },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400, headers: corsHeaders(origin) },
    );
  }

  const { sessionId, message } = parsed.data;

  const client = await pool.connect();
  let conversationId: string;
  let contactId: string;

  try {
    await client.query('BEGIN');

    // Upsert anonymous contact keyed by (WIX, sessionId)
    const contactResult = await client.query<{ id: string }>(`
      INSERT INTO contacts (display_name, source_channel, external_contact_ref)
      VALUES ($1, $2, $3)
      ON CONFLICT (source_channel, external_contact_ref) DO NOTHING
      RETURNING id
    `, [`Widget:${sessionId}`, WIDGET_CHANNEL, sessionId]);

    if (contactResult.rows.length) {
      contactId = contactResult.rows[0].id;
    } else {
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM contacts WHERE source_channel = $1 AND external_contact_ref = $2`,
        [WIDGET_CHANNEL, sessionId],
      );
      contactId = existing.rows[0].id;
    }

    // Find or create conversation — no 24-hour window constraint for web widget
    await client.query(`
      INSERT INTO conversations (contact_id, channel)
      VALUES ($1, $2)
      ON CONFLICT (contact_id, channel) DO NOTHING
    `, [contactId, WIDGET_CHANNEL]);

    const convResult = await client.query<{ id: string }>(
      `SELECT id FROM conversations WHERE contact_id = $1 AND channel = $2 LIMIT 1`,
      [contactId, WIDGET_CHANNEL],
    );
    conversationId = convResult.rows[0].id;

    // Store inbound message
    await client.query(`
      INSERT INTO messages (conversation_id, direction, body)
      VALUES ($1, 'IN', $2)
    `, [conversationId, message]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('Widget chat DB error:', err);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders(origin) },
    );
  }
  client.release();

  // Load recent history for AI context
  const msgsRow = await pool.query<{ direction: 'IN' | 'OUT'; body: string }>(
    `SELECT direction, body FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [conversationId],
  );
  const history: Anthropic.MessageParam[] = msgsRow.rows.reverse().map(m => ({
    role: m.direction === 'IN' ? 'user' : 'assistant',
    content: m.body,
  }));

  // Run AI synchronously — web users expect an immediate reply
  let reply = '';
  try {
    const aiResult = await generateResponse(history, contactId, conversationId);
    reply = aiResult.reply;
  } catch (err) {
    console.error('Widget AI error:', err);
    reply = 'عذراً، حدث خطأ مؤقت. يرجى المحاولة مرة أخرى. / A temporary error occurred. Please try again.';
  }

  if (reply) {
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, body) VALUES ($1, 'OUT', $2)`,
      [conversationId, reply],
    ).catch(err => console.error('Widget reply store error:', err));
  }

  return NextResponse.json(
    { reply: reply || 'عذراً، لم أتمكن من الرد. / Unable to respond.' },
    { headers: corsHeaders(origin) },
  );
}
