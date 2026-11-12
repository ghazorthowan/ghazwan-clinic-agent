/**
 * M2 contract tests — official Meta webhook fixture shapes.
 * Covers multi-message batches, non-text message types, delivery status
 * callbacks, and template message payloads.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createHmac } from 'node:crypto';
import { setupTestDb } from '../helpers/db';

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

const APP_SECRET = 'test_secret_m2';
const VERIFY_TOKEN = 'test_verify_m2';

let pool: Pool;
let teardown: () => Promise<void>;
let handlePOST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ pool, teardown } = await setupTestDb('webhook_m2'));
  process.env.DATABASE_URL = pool.options.connectionString as string;
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

  const route = await import('../../app/api/webhook/whatsapp/route');
  handlePOST = (req) => route.POST(req as never);
}, 30_000);

afterAll(async () => {
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  await teardown();
}, 15_000);

function makeRequest(body: string) {
  return new Request('http://localhost/api/webhook/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sign(body, APP_SECRET) },
    body,
  });
}

function waPayload(messages: object[], contacts: object[] = [], statuses: object[] = []) {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'BA_M2',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'PN_M2', display_phone_number: '+96400000000' },
          contacts,
          messages: messages.length ? messages : undefined,
          statuses: statuses.length ? statuses : undefined,
        },
        field: 'messages',
      }],
    }],
  });
}

// ---------------------------------------------------------------------------
// Multi-message batch
// ---------------------------------------------------------------------------

describe('multi-message batch', () => {
  it('stores two messages from the same contact in one payload', async () => {
    const body = waPayload(
      [
        { id: 'wamid.BATCH001', from: '9647010000001', timestamp: '1700100000', type: 'text', text: { body: 'Hello' } },
        { id: 'wamid.BATCH002', from: '9647010000001', timestamp: '1700100005', type: 'text', text: { body: 'مرحبا' } },
      ],
      [{ profile: { name: 'Batch User' }, wa_id: '9647010000001' }],
    );
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const rows = await pool.query(
      `SELECT provider_message_id FROM messages WHERE provider_message_id LIKE 'wamid.BATCH%' ORDER BY provider_message_id`,
    );
    expect(rows.rowCount).toBe(2);
    expect(rows.rows[0].provider_message_id).toBe('wamid.BATCH001');
    expect(rows.rows[1].provider_message_id).toBe('wamid.BATCH002');
  });

  it('two messages create only one contact + conversation', async () => {
    const body = waPayload(
      [
        { id: 'wamid.BATCH003', from: '9647010000002', timestamp: '1700200000', type: 'text', text: { body: 'First' } },
        { id: 'wamid.BATCH004', from: '9647010000002', timestamp: '1700200010', type: 'text', text: { body: 'Second' } },
      ],
      [{ profile: { name: 'Single Contact' }, wa_id: '9647010000002' }],
    );
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const contacts = await pool.query(
      `SELECT id FROM contacts WHERE phone = '+9647010000002'`,
    );
    expect(contacts.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Non-text message types (image, audio, reaction) — must be silently ignored
// ---------------------------------------------------------------------------

describe('non-text message types', () => {
  it('ignores an image message — no DB row created', async () => {
    const body = waPayload(
      [{ id: 'wamid.IMG001', from: '9647020000001', timestamp: '1700300000', type: 'image', image: { id: 'img123', mime_type: 'image/jpeg', sha256: 'abc', caption: '' } }],
      [{ profile: { name: 'Image Sender' }, wa_id: '9647020000001' }],
    );
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const rows = await pool.query(`SELECT id FROM messages WHERE provider_message_id = 'wamid.IMG001'`);
    expect(rows.rowCount).toBe(0);
  });

  it('ignores an audio message', async () => {
    const body = waPayload(
      [{ id: 'wamid.AUD001', from: '9647020000002', timestamp: '1700300100', type: 'audio', audio: { id: 'aud123', mime_type: 'audio/ogg' } }],
      [{ profile: { name: 'Audio Sender' }, wa_id: '9647020000002' }],
    );
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const rows = await pool.query(`SELECT id FROM messages WHERE provider_message_id = 'wamid.AUD001'`);
    expect(rows.rowCount).toBe(0);
  });

  it('ignores a reaction message', async () => {
    const body = waPayload(
      [{ id: 'wamid.REACT001', from: '9647020000003', timestamp: '1700300200', type: 'reaction', reaction: { message_id: 'wamid.OTHER', emoji: '👍' } }],
      [{ profile: { name: 'React Sender' }, wa_id: '9647020000003' }],
    );
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const rows = await pool.query(`SELECT id FROM messages WHERE provider_message_id = 'wamid.REACT001'`);
    expect(rows.rowCount).toBe(0);
  });

  it('processes a text message in a batch that also contains non-text', async () => {
    const body = waPayload(
      [
        { id: 'wamid.MIX001', from: '9647020000004', timestamp: '1700400000', type: 'image', image: { id: 'img456', mime_type: 'image/jpeg' } },
        { id: 'wamid.MIX002', from: '9647020000004', timestamp: '1700400010', type: 'text', text: { body: 'Send the image' } },
      ],
      [{ profile: { name: 'Mixed Sender' }, wa_id: '9647020000004' }],
    );
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const rows = await pool.query(`SELECT provider_message_id FROM messages WHERE provider_message_id IN ('wamid.MIX001','wamid.MIX002')`);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].provider_message_id).toBe('wamid.MIX002');
  });
});

// ---------------------------------------------------------------------------
// Delivery status callbacks — informational, updates delivered_at
// ---------------------------------------------------------------------------

describe('delivery status callbacks', () => {
  it('a status-only payload returns 200 and stores no message', async () => {
    const body = waPayload([], [], [
      { id: 'wamid.OUTBOUND001', status: 'delivered', timestamp: '1700500000', recipient_id: '9647030000001' },
    ]);
    const countBefore = (await pool.query(`SELECT count(*) FROM messages`)).rows[0].count;
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);
    const countAfter = (await pool.query(`SELECT count(*) FROM messages`)).rows[0].count;
    expect(countAfter).toBe(countBefore);
  });

  it('sets delivered_at on a matching outbound message', async () => {
    // Insert a fake outbound message with a known provider_message_id
    const msgId = 'wamid.OUTBOUND002';
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, body, provider_message_id)
       SELECT id, 'OUT', 'Test outbound', $1 FROM conversations LIMIT 1`,
      [msgId],
    );

    const body = waPayload([], [], [
      { id: msgId, status: 'delivered', timestamp: '1700600000', recipient_id: '9647030000002' },
    ]);
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const row = await pool.query<{ delivered_at: Date | null }>(
      `SELECT delivered_at FROM messages WHERE provider_message_id = $1`, [msgId],
    );
    expect(row.rows[0]?.delivered_at).not.toBeNull();
  });

  it('a "read" status also sets delivered_at', async () => {
    const msgId = 'wamid.OUTBOUND003';
    await pool.query(
      `INSERT INTO messages (conversation_id, direction, body, provider_message_id)
       SELECT id, 'OUT', 'Test read', $1 FROM conversations LIMIT 1`,
      [msgId],
    );

    const body = waPayload([], [], [
      { id: msgId, status: 'read', timestamp: '1700700000', recipient_id: '9647030000003' },
    ]);
    await handlePOST(makeRequest(body));

    const row = await pool.query<{ delivered_at: Date | null }>(
      `SELECT delivered_at FROM messages WHERE provider_message_id = $1`, [msgId],
    );
    expect(row.rows[0]?.delivered_at).not.toBeNull();
  });
});
