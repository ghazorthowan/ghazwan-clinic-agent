import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  verifySignature,
  normalizeInbound,
  isWithinWindow,
  newWindowExpiry,
  type MetaWebhookPayload,
} from '../../lib/whatsapp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSignature(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

// Meta's official example payload (text message)
const TEXT_PAYLOAD: MetaWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123456789',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              phone_number_id: 'PHONE_NUMBER_ID',
              display_phone_number: '+1555000000',
            },
            contacts: [{ profile: { name: 'Ahmed Al-Rashid' }, wa_id: '9647001234567' }],
            messages: [
              {
                id: 'wamid.ABC123',
                from: '9647001234567',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'مرحبا، أريد حجز موعد' },
              },
            ],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

// Status update only (no messages array)
const STATUS_PAYLOAD: MetaWebhookPayload = {
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '123456789',
      changes: [
        {
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              phone_number_id: 'PHONE_NUMBER_ID',
              display_phone_number: '+1555000000',
            },
            statuses: [{ id: 'wamid.ABC123', status: 'delivered', timestamp: '1700000001' }],
          },
          field: 'messages',
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// verifySignature
// ---------------------------------------------------------------------------

describe('verifySignature', () => {
  const SECRET = 'test_secret_42';
  const BODY = '{"object":"whatsapp_business_account"}';

  it('returns true for a correct signature', () => {
    const sig = makeSignature(BODY, SECRET);
    expect(verifySignature(Buffer.from(BODY), sig, SECRET)).toBe(true);
  });

  it('returns false when signature is wrong', () => {
    expect(verifySignature(Buffer.from(BODY), 'sha256=deadbeef', SECRET)).toBe(false);
  });

  it('returns false when header is null', () => {
    expect(verifySignature(Buffer.from(BODY), null, SECRET)).toBe(false);
  });

  it('returns false when header lacks sha256= prefix', () => {
    const hex = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verifySignature(Buffer.from(BODY), hex, SECRET)).toBe(false);
  });

  it('returns false when body has been tampered', () => {
    const sig = makeSignature(BODY, SECRET);
    expect(verifySignature(Buffer.from(BODY + '!'), sig, SECRET)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeInbound
// ---------------------------------------------------------------------------

describe('normalizeInbound', () => {
  it('extracts a text message from the official fixture', () => {
    const result = normalizeInbound(TEXT_PAYLOAD);
    expect(result).toHaveLength(1);
    const msg = result[0];
    expect(msg.providerMessageId).toBe('wamid.ABC123');
    expect(msg.fromPhone).toBe('+9647001234567');
    expect(msg.displayName).toBe('Ahmed Al-Rashid');
    expect(msg.body).toBe('مرحبا، أريد حجز موعد');
    expect(msg.phoneNumberId).toBe('PHONE_NUMBER_ID');
    expect(msg.providerTimestamp).toEqual(new Date(1700000000 * 1000));
  });

  it('returns empty array for status-only payload', () => {
    expect(normalizeInbound(STATUS_PAYLOAD)).toHaveLength(0);
  });

  it('returns empty array when object is not whatsapp_business_account', () => {
    const bad = { ...TEXT_PAYLOAD, object: 'instagram' };
    expect(normalizeInbound(bad)).toHaveLength(0);
  });

  it('falls back to wa_id as displayName when no contacts entry', () => {
    const noContacts: MetaWebhookPayload = {
      ...TEXT_PAYLOAD,
      entry: TEXT_PAYLOAD.entry.map(e => ({
        ...e,
        changes: e.changes.map(c => ({
          ...c,
          value: { ...c.value, contacts: [] },
        })),
      })),
    };
    const result = normalizeInbound(noContacts);
    expect(result[0].displayName).toBe('9647001234567');
  });

  it('handles multiple messages in one webhook call', () => {
    const multi: MetaWebhookPayload = {
      ...TEXT_PAYLOAD,
      entry: TEXT_PAYLOAD.entry.map(e => ({
        ...e,
        changes: e.changes.map(c => ({
          ...c,
          value: {
            ...c.value,
            contacts: [
              { profile: { name: 'Ahmed' }, wa_id: '9647001234567' },
              { profile: { name: 'Sara' }, wa_id: '9647007654321' },
            ],
            messages: [
              { id: 'msg1', from: '9647001234567', timestamp: '1700000000', type: 'text', text: { body: 'Hello' } },
              { id: 'msg2', from: '9647007654321', timestamp: '1700000001', type: 'text', text: { body: 'Hi' } },
            ],
          },
        })),
      })),
    };
    const result = normalizeInbound(multi);
    expect(result).toHaveLength(2);
    expect(result[0].fromPhone).toBe('+9647001234567');
    expect(result[1].fromPhone).toBe('+9647007654321');
  });

  it('skips non-text message types', () => {
    const withImage: MetaWebhookPayload = {
      ...TEXT_PAYLOAD,
      entry: TEXT_PAYLOAD.entry.map(e => ({
        ...e,
        changes: e.changes.map(c => ({
          ...c,
          value: {
            ...c.value,
            messages: [
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { id: 'img1', from: '9647001234567', timestamp: '1700000000', type: 'image' as any, text: undefined as any },
            ],
          },
        })),
      })),
    };
    expect(normalizeInbound(withImage)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 24-hour window helpers
// ---------------------------------------------------------------------------

describe('isWithinWindow / newWindowExpiry', () => {
  it('returns false when windowExpiresAt is null', () => {
    expect(isWithinWindow(null)).toBe(false);
  });

  it('returns true when window has not yet expired', () => {
    const future = new Date(Date.now() + 60_000);
    expect(isWithinWindow(future)).toBe(true);
  });

  it('returns false when window has expired', () => {
    const past = new Date(Date.now() - 60_000);
    expect(isWithinWindow(past)).toBe(false);
  });

  it('newWindowExpiry adds exactly 24 hours', () => {
    const ts = new Date('2024-01-01T10:00:00Z');
    const expiry = newWindowExpiry(ts);
    expect(expiry.getTime() - ts.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
