/**
 * POST /api/ai/respond
 *
 * Internal endpoint called after a new inbound WhatsApp message is stored.
 * Loads the conversation history, runs the AI response engine, and stores
 * the outbound reply in the messages table.
 *
 * This endpoint is NOT exposed to the public internet — it should only be
 * called by internal webhook processing logic (or a job queue in production).
 * It is protected by the INTERNAL_API_SECRET environment variable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { generateResponse } from '@/lib/ai';
import { isWithinWindow } from '@/lib/whatsapp';
import type Anthropic from '@anthropic-ai/sdk';

export async function POST(req: NextRequest) {
  // Internal secret check — not a user-facing auth mechanism
  const secret = process.env.INTERNAL_API_SECRET;
  if (secret) {
    const auth = req.headers.get('x-internal-secret');
    if (auth !== secret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  let body: { conversationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { conversationId } = body;
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 422 });
  }

  // Load conversation metadata
  const convRow = await pool.query<{
    id: string;
    contact_id: string;
    status: string;
    window_expires_at: Date | null;
    phone_number_id: string | null;
  }>(
    `SELECT id, contact_id, status, window_expires_at, phone_number_id FROM conversations WHERE id = $1`,
    [conversationId],
  );
  if (!convRow.rows.length) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }
  const conv = convRow.rows[0];

  // Don't auto-respond if a human has taken over
  if (conv.status === 'HUMAN') {
    return NextResponse.json({ skipped: 'human_handoff' });
  }

  // Don't send a free-form reply outside the 24-hour messaging window
  if (!isWithinWindow(conv.window_expires_at)) {
    return NextResponse.json({ skipped: 'outside_window' });
  }

  // Load recent message history (last 20 messages to keep context window manageable)
  const msgsRow = await pool.query<{
    direction: 'IN' | 'OUT';
    body: string;
  }>(
    `SELECT direction, body FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [conversationId],
  );
  const recentMessages = msgsRow.rows.reverse();

  // Build Anthropic message history
  const history: Anthropic.MessageParam[] = recentMessages.map(m => ({
    role: m.direction === 'IN' ? 'user' : 'assistant',
    content: m.body,
  }));

  // Ensure the last message is from the user
  if (!history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ skipped: 'no_pending_user_message' });
  }

  // Generate AI response
  const aiResult = await generateResponse(history, conv.contact_id, conversationId);

  if (!aiResult.reply) {
    return NextResponse.json({ skipped: 'empty_reply' });
  }

  // Store the outbound reply — phone_number_id lets the outbox worker know which WA number to send from
  await pool.query(
    `INSERT INTO messages (conversation_id, direction, body, phone_number_id) VALUES ($1, 'OUT', $2, $3)`,
    [conversationId, aiResult.reply, conv.phone_number_id],
  );

  return NextResponse.json({
    reply: aiResult.reply,
    toolsUsed: aiResult.toolsUsed,
    escalated: aiResult.escalated,
    tokensUsed: aiResult.tokensUsed,
  });
}
