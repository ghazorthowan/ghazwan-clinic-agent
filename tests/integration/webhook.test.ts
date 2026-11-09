import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { createHmac } from 'node:crypto';
import { setupTestDb } from '../helpers/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

function metaPayload(opts: {
  msgId?: string;
  from?: string;
  name?: string;
  body?: string;
  ts?: number;
}) {
  const {
    msgId = 'wamid.TEST001',
    from = '9647001234567',
    name = 'Ahmed Al-Rashid',
    body = 'مرحبا، أريد حجز موعد',
    ts = 1700000000,
  } = opts;

  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'BA_ID',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'PN_ID', display_phone_number: '+1555000000' },
              contacts: [{ profile: { name }, wa_id: from }],
              messages: [{ id: msgId, from, timestamp: String(ts), type: 'text', text: { body } }],
            },
            field: 'messages',
          },
        ],
      },
    ],
  });
}

const APP_SECRET = 'test_whatsapp_secret';
const VERIFY_TOKEN = 'test_verify_token';

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let pool: Pool;
let teardown: () => Promise<void>;

// We test the handler functions directly (bypassing Next.js routing)
// to avoid spinning up a full HTTP server in integration tests.
let handleGET: (req: Request) => Promise<Response>;
let handlePOST: (req: Request) => Promise<Response>;

beforeAll(async () => {
  ({ pool, teardown } = await setupTestDb('webhook'));

  process.env.DATABASE_URL = pool.options.connectionString as string;
  process.env.WHATSAPP_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;

  // Dynamic import AFTER env vars are set so the module picks them up
  const route = await import('../../app/api/webhook/whatsapp/route');
  handleGET  = (req) => route.GET(req as never);
  handlePOST = (req) => route.POST(req as never);
});

afterAll(async () => {
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  await teardown();
});

// ---------------------------------------------------------------------------
// GET — challenge verification
// ---------------------------------------------------------------------------

describe('GET /api/webhook/whatsapp', () => {
  function makeGET(params: Record<string, string>) {
    const url = new URL('http://localhost/api/webhook/whatsapp');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return new Request(url.toString());
  }

  it('responds with the challenge when verify_token matches', async () => {
    const req = makeGET({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc123' });
    const res = await handleGET(req);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
  });

  it('returns 403 when verify_token is wrong', async () => {
    const req = makeGET({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' });
    const res = await handleGET(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 when hub.mode is not subscribe', async () => {
    const req = makeGET({ 'hub.mode': 'unsubscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'abc123' });
    const res = await handleGET(req);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST — inbound message processing
// ---------------------------------------------------------------------------

describe('POST /api/webhook/whatsapp', () => {
  function makeRequest(body: string, secret = APP_SECRET) {
    return new Request('http://localhost/api/webhook/whatsapp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': sign(body, secret),
      },
      body,
    });
  }

  it('returns 401 when signature is invalid', async () => {
    const body = metaPayload({});
    const req = new Request('http://localhost/api/webhook/whatsapp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
      body,
    });
    const res = await handlePOST(req);
    expect(res.status).toBe(401);
  });

  it('stores an inbound message and upserts contact + conversation', async () => {
    const body = metaPayload({ msgId: 'wamid.INT001', from: '9647001111111', name: 'Fatima Hassan' });
    const res = await handlePOST(makeRequest(body));
    expect(res.status).toBe(200);

    const contact = await pool.query(
      `SELECT display_name FROM contacts WHERE external_contact_ref = $1`,
      ['+9647001111111']
    );
    expect(contact.rows[0].display_name).toBe('Fatima Hassan');

    const msg = await pool.query(
      `SELECT body, provider_message_id FROM messages WHERE provider_message_id = 'wamid.INT001'`
    );
    expect(msg.rows[0].body).toBe('مرحبا، أريد حجز موعد');
  });

  it('is idempotent — duplicate provider_message_id is silently ignored', async () => {
    const body = metaPayload({ msgId: 'wamid.INT002', from: '9647002222222', name: 'Omar Karimi' });
    const res1 = await handlePOST(makeRequest(body));
    const res2 = await handlePOST(makeRequest(body));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const rows = await pool.query(
      `SELECT id FROM messages WHERE provider_message_id = 'wamid.INT002'`
    );
    expect(rows.rowCount).toBe(1);
  });

  it('updates window_expires_at on the conversation', async () => {
    const ts = 1700000000;
    const body = metaPayload({ msgId: 'wamid.INT003', from: '9647003333333', name: 'Sara Khalil', ts });
    await handlePOST(makeRequest(body));

    const row = await pool.query<{ window_expires_at: Date }>(`
      SELECT cv.window_expires_at
      FROM conversations cv
      JOIN contacts ct ON ct.id = cv.contact_id
      WHERE ct.external_contact_ref = '+9647003333333'
    `);
    const expiry = new Date(row.rows[0].window_expires_at);
    const expected = new Date((ts + 24 * 3600) * 1000);
    expect(Math.abs(expiry.getTime() - expected.getTime())).toBeLessThan(1000);
  });

  it('returns 200 for a status-only payload (no messages stored)', async () => {
    const statusPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{
        id: 'BA_ID',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'PN_ID', display_phone_number: '+1555000000' },
            statuses: [{ id: 'wamid.ABC', status: 'delivered', timestamp: '1700000001' }],
          },
          field: 'messages',
        }],
      }],
    });
    const before = await pool.query(`SELECT count(*) FROM messages`);
    const res = await handlePOST(makeRequest(statusPayload));
    expect(res.status).toBe(200);
    const after = await pool.query(`SELECT count(*) FROM messages`);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });
});
