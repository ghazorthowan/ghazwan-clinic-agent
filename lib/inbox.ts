import { pool } from './db';
import type { Pool } from 'pg';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationSummary {
  id: string;
  contactPhone: string;
  contactName: string;
  channel: string;
  status: 'AI' | 'HUMAN';
  windowExpiresAt: Date | null;
  lastMessageAt: Date | null;
  lastMessageBody: string | null;
  unreadCount: number;
  createdAt: Date;
}

export interface Message {
  id: number;
  direction: 'IN' | 'OUT';
  body: string;
  providerMessageId: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// List conversations (most recent activity first)
// ---------------------------------------------------------------------------

export async function listConversations(db: Pool = pool): Promise<ConversationSummary[]> {
  const result = await db.query<{
    id: string;
    contact_phone: string;
    contact_name: string;
    channel: string;
    status: 'AI' | 'HUMAN';
    window_expires_at: Date | null;
    last_message_at: Date | null;
    last_message_body: string | null;
    unread_count: string;
    created_at: Date;
  }>(`
    SELECT
      cv.id,
      ct.phone        AS contact_phone,
      ct.display_name AS contact_name,
      cv.channel,
      cv.status,
      cv.window_expires_at,
      cv.created_at,
      m_last.created_at   AS last_message_at,
      m_last.body         AS last_message_body,
      COALESCE(unread.cnt, 0) AS unread_count
    FROM conversations cv
    JOIN contacts ct ON ct.id = cv.contact_id
    LEFT JOIN LATERAL (
      SELECT body, created_at
      FROM messages
      WHERE conversation_id = cv.id
      ORDER BY created_at DESC
      LIMIT 1
    ) m_last ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS cnt
      FROM messages
      WHERE conversation_id = cv.id AND direction = 'IN'
    ) unread ON true
    ORDER BY COALESCE(m_last.created_at, cv.created_at) DESC
  `);

  return result.rows.map(r => ({
    id: r.id,
    contactPhone: r.contact_phone,
    contactName: r.contact_name,
    channel: r.channel,
    status: r.status,
    windowExpiresAt: r.window_expires_at,
    lastMessageAt: r.last_message_at,
    lastMessageBody: r.last_message_body,
    unreadCount: parseInt(r.unread_count, 10),
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Get messages for one conversation
// ---------------------------------------------------------------------------

export async function getMessages(
  conversationId: string,
  db: Pool = pool,
): Promise<Message[]> {
  const result = await db.query<{
    id: number;
    direction: 'IN' | 'OUT';
    body: string;
    provider_message_id: string | null;
    created_at: Date;
  }>(`
    SELECT id, direction, body, provider_message_id, created_at
    FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC
  `, [conversationId]);

  return result.rows.map(r => ({
    id: r.id,
    direction: r.direction,
    body: r.body,
    providerMessageId: r.provider_message_id,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Toggle AI ↔ HUMAN handoff
// ---------------------------------------------------------------------------

export type HandoffStatus = 'AI' | 'HUMAN';

export async function setHandoff(
  conversationId: string,
  status: HandoffStatus,
  db: Pool = pool,
): Promise<boolean> {
  const result = await db.query(
    `UPDATE conversations SET status = $1 WHERE id = $2`,
    [status, conversationId],
  );
  return (result.rowCount ?? 0) > 0;
}
