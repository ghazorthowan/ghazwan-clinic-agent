import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { setupTestDb } from '../helpers/db';
import { randomUUID } from 'node:crypto';

let pool: Pool;
let teardown: () => Promise<void>;
let listConversations: typeof import('../../lib/inbox').listConversations;
let getMessages: typeof import('../../lib/inbox').getMessages;
let setHandoff: typeof import('../../lib/inbox').setHandoff;

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedContact(phone: string, name: string) {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO contacts (display_name, phone, source_channel, external_contact_ref)
     VALUES ($1, $2, 'WA_01', $2) RETURNING id`,
    [name, phone],
  );
  return r.rows[0].id;
}

async function seedConversation(contactId: string, channel = 'WA_01') {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO conversations (contact_id, channel) VALUES ($1, $2) RETURNING id`,
    [contactId, channel],
  );
  return r.rows[0].id;
}

async function seedMessage(conversationId: string, direction: 'IN' | 'OUT', body: string) {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO messages (conversation_id, direction, body) VALUES ($1, $2, $3) RETURNING id`,
    [conversationId, direction, body],
  );
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  ({ pool, teardown } = await setupTestDb('inbox'));
  process.env.DATABASE_URL = pool.options.connectionString as string;

  const mod = await import('../../lib/inbox');
  listConversations = mod.listConversations;
  getMessages       = mod.getMessages;
  setHandoff        = mod.setHandoff;
});

afterAll(async () => { await teardown(); });

// ---------------------------------------------------------------------------
// listConversations
// ---------------------------------------------------------------------------

describe('listConversations', () => {
  it('returns conversations ordered by most recent message first', async () => {
    const c1 = await seedContact('+9647001001001', 'Ahmed Al-Rashid');
    const c2 = await seedContact('+9647001002002', 'Fatima Hassan');
    const cv1 = await seedConversation(c1);
    const cv2 = await seedConversation(c2);

    await seedMessage(cv1, 'IN', 'First message');
    // small delay so timestamps differ
    await new Promise(r => setTimeout(r, 10));
    await seedMessage(cv2, 'IN', 'Latest message');

    const result = await listConversations(pool);
    const ids = result.map(r => r.id);
    expect(ids.indexOf(cv2)).toBeLessThan(ids.indexOf(cv1));
  });

  it('includes contactName and lastMessageBody', async () => {
    const c = await seedContact('+9647001003003', 'Omar Karimi');
    const cv = await seedConversation(c);
    await seedMessage(cv, 'IN', 'Hello clinic');

    const result = await listConversations(pool);
    const row = result.find(r => r.id === cv);
    expect(row?.contactName).toBe('Omar Karimi');
    expect(row?.lastMessageBody).toBe('Hello clinic');
  });

  it('defaults status to AI', async () => {
    const c = await seedContact('+9647001004004', 'Sara Khalil');
    const cv = await seedConversation(c);

    const result = await listConversations(pool);
    const row = result.find(r => r.id === cv);
    expect(row?.status).toBe('AI');
  });
});

// ---------------------------------------------------------------------------
// getMessages
// ---------------------------------------------------------------------------

describe('getMessages', () => {
  it('returns messages in ascending order', async () => {
    const c = await seedContact('+9647001005005', 'Noor Al-Ali');
    const cv = await seedConversation(c);
    await seedMessage(cv, 'IN', 'First');
    await new Promise(r => setTimeout(r, 10));
    await seedMessage(cv, 'OUT', 'Reply');

    const msgs = await getMessages(cv, pool);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].direction).toBe('IN');
    expect(msgs[0].body).toBe('First');
    expect(msgs[1].direction).toBe('OUT');
  });

  it('returns empty array for a conversation with no messages', async () => {
    const c = await seedContact('+9647001006006', 'Zaid Ibrahim');
    const cv = await seedConversation(c);
    expect(await getMessages(cv, pool)).toHaveLength(0);
  });

  it('only returns messages for the requested conversation', async () => {
    const c1 = await seedContact('+9647001007007', 'Lina Mansour');
    const c2 = await seedContact('+9647001008008', 'Kareem Saleh');
    const cv1 = await seedConversation(c1);
    const cv2 = await seedConversation(c2);
    await seedMessage(cv1, 'IN', 'CV1 message');
    await seedMessage(cv2, 'IN', 'CV2 message');

    const msgs = await getMessages(cv1, pool);
    expect(msgs.every(m => m.body === 'CV1 message')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// setHandoff
// ---------------------------------------------------------------------------

describe('setHandoff', () => {
  it('switches a conversation from AI to HUMAN', async () => {
    const c = await seedContact('+9647001009009', 'Reem Qasim');
    const cv = await seedConversation(c);

    const updated = await setHandoff(cv, 'HUMAN', pool);
    expect(updated).toBe(true);

    const row = await pool.query<{ status: string }>(`SELECT status FROM conversations WHERE id = $1`, [cv]);
    expect(row.rows[0].status).toBe('HUMAN');
  });

  it('switches a conversation from HUMAN back to AI', async () => {
    const c = await seedContact('+9647001010010', 'Hana Yusuf');
    const cv = await seedConversation(c);
    await setHandoff(cv, 'HUMAN', pool);
    await setHandoff(cv, 'AI', pool);

    const row = await pool.query<{ status: string }>(`SELECT status FROM conversations WHERE id = $1`, [cv]);
    expect(row.rows[0].status).toBe('AI');
  });

  it('returns false for a non-existent conversation id', async () => {
    const updated = await setHandoff(randomUUID(), 'HUMAN', pool);
    expect(updated).toBe(false);
  });
});
