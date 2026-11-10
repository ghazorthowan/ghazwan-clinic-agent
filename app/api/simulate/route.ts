import { NextResponse } from 'next/server';
import { loggedIn } from '@/lib/auth';
import { messageInput } from '@/lib/schema';
import { pool } from '@/lib/db';
import { generateResponse } from '@/lib/ai';
import type Anthropic from '@anthropic-ai/sdk';

const SIM_CHANNEL = 'SIMULATED_WHATSAPP';

export async function POST(req: Request) {
  if (!await loggedIn()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = messageInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid simulator input' }, { status: 400 });

  const i = parsed.data;
  const client = await pool.connect();

  let conversationId: string;
  let contactId: string;

  try {
    await client.query('BEGIN');

    // Upsert simulated contact
    const contactResult = await client.query<{ id: string }>(`
      INSERT INTO contacts (display_name, phone, source_channel, external_contact_ref)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (source_channel, external_contact_ref)
        DO UPDATE SET display_name = EXCLUDED.display_name
      RETURNING id
    `, [i.name, i.phone ?? i.contactRef, SIM_CHANNEL, i.contactRef]);
    contactId = contactResult.rows[0].id;

    // Find or create conversation
    await client.query(`
      INSERT INTO conversations (contact_id, channel)
      VALUES ($1, $2)
      ON CONFLICT (contact_id, channel) DO NOTHING
    `, [contactId, SIM_CHANNEL]);

    const convResult = await client.query<{ id: string; window_expires_at: Date | null; status: string }>(`
      SELECT id, window_expires_at, status FROM conversations
      WHERE contact_id = $1 AND channel = $2 LIMIT 1
    `, [contactId, SIM_CHANNEL]);
    const conv = convResult.rows[0];
    conversationId = conv.id;

    // Extend 24-hour window for the simulator (treat now as message timestamp)
    await client.query(`
      UPDATE conversations SET window_expires_at = NOW() + INTERVAL '24 hours' WHERE id = $1
    `, [conversationId]);

    // Store inbound message
    await client.query(`
      INSERT INTO messages (conversation_id, direction, body) VALUES ($1, 'IN', $2)
    `, [conversationId, i.body]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    console.error('Simulate DB error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  client.release();

  // Load last 20 messages as history for the AI
  const msgsRow = await pool.query<{ direction: 'IN' | 'OUT'; body: string }>(`
    SELECT direction, body FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at DESC LIMIT 20
  `, [conversationId]);
  const history: Anthropic.MessageParam[] = msgsRow.rows.reverse().map(m => ({
    role: m.direction === 'IN' ? 'user' : 'assistant',
    content: m.body,
  }));

  if (!history.length || history[history.length - 1].role !== 'user') {
    return NextResponse.json({ reply: '' });
  }

  // Generate AI response
  const aiResult = await generateResponse(history, contactId, conversationId);

  if (aiResult.reply) {
    await pool.query(`
      INSERT INTO messages (conversation_id, direction, body) VALUES ($1, 'OUT', $2)
    `, [conversationId, aiResult.reply]);
  }

  return NextResponse.json({
    reply: aiResult.reply,
    escalated: aiResult.escalated,
    toolsUsed: aiResult.toolsUsed,
  });
}
