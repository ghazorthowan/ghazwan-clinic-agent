/**
 * Meta Social Webhook normalizers for Instagram Business and Facebook Messenger.
 *
 * Both channels use the same Facebook App webhook (object: 'instagram' | 'page')
 * and the same HMAC-SHA256 signature verification, keyed by META_APP_SECRET.
 *
 * CLAUDE.md rule 2: Credentials must be separately obtained from Meta Business Manager.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Signature verification (identical algorithm to WhatsApp)
// ---------------------------------------------------------------------------

export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payload types — Messenger + Instagram share the same shape
// ---------------------------------------------------------------------------

export interface MetaSocialMessaging {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
  };
}

export interface MetaSocialEntry {
  id: string; // Page ID or IG account ID (used as channel discriminator)
  time?: number;
  messaging?: MetaSocialMessaging[];
}

export interface MetaSocialPayload {
  object: 'instagram' | 'page' | string;
  entry: MetaSocialEntry[];
}

// ---------------------------------------------------------------------------
// Normalized inbound event (channel-agnostic)
// ---------------------------------------------------------------------------

export interface NormalizedSocialInbound {
  providerMessageId: string;
  providerTimestamp: Date;
  senderId: string;    // PSID (Messenger) or IG-scoped user ID
  recipientId: string; // Page ID or IG account ID
  body: string;
  channel: 'INSTAGRAM' | 'FACEBOOK'; // matches contacts.source_channel CHECK constraint
}

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

export function normalizeInstagram(payload: MetaSocialPayload): NormalizedSocialInbound[] {
  if (payload.object !== 'instagram') return [];
  return extractMessaging(payload, 'INSTAGRAM');
}

export function normalizeMessenger(payload: MetaSocialPayload): NormalizedSocialInbound[] {
  if (payload.object !== 'page') return [];
  return extractMessaging(payload, 'FACEBOOK');
}

function extractMessaging(
  payload: MetaSocialPayload,
  channel: 'INSTAGRAM' | 'FACEBOOK',
): NormalizedSocialInbound[] {
  const results: NormalizedSocialInbound[] = [];

  for (const entry of payload.entry) {
    for (const m of entry.messaging ?? []) {
      // Only handle text messages; skip reads, echoes, reactions
      if (!m.message?.mid || !m.message.text) continue;

      results.push({
        providerMessageId: m.message.mid,
        providerTimestamp: new Date(m.timestamp),
        senderId: m.sender.id,
        recipientId: m.recipient.id,
        body: m.message.text,
        channel,
      });
    }
  }

  return results;
}
