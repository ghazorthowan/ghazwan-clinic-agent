/**
 * TikTok Business Messaging adapter — M3.
 *
 * Gated behind TIKTOK_ENABLED=true. This module must NOT be used until
 * TikTok Business Messaging access has been separately approved and configured.
 *
 * CLAUDE.md rule 2: TikTok Business Messaging credentials and eligibility
 * must be separately obtained from TikTok for Business.
 * CLAUDE.md rule 8: Do not connect third-party accounts without explicit approval.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

export function isTikTokEnabled(): boolean {
  return process.env.TIKTOK_ENABLED === 'true';
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

export function verifyTikTokSignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  // TikTok uses HMAC-SHA256 hex digest in the X-TikTok-Signature header
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    return timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHeader, 'hex'),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Payload types (TikTok Business Messaging webhook format)
// ---------------------------------------------------------------------------

export interface TikTokMessage {
  message_id: string;
  sender_id: string;
  timestamp: number; // milliseconds
  content: {
    message_type: string;
    text?: string;
  };
}

export interface TikTokWebhookPayload {
  event_type: string;
  messages?: TikTokMessage[];
}

// ---------------------------------------------------------------------------
// Normalized inbound event
// ---------------------------------------------------------------------------

export interface NormalizedTikTokInbound {
  providerMessageId: string;
  providerTimestamp: Date;
  senderId: string;
  body: string;
  channel: 'TIKTOK';
}

export function normalizeTikTok(payload: TikTokWebhookPayload): NormalizedTikTokInbound[] {
  if (payload.event_type !== 'message') return [];
  const results: NormalizedTikTokInbound[] = [];
  for (const msg of payload.messages ?? []) {
    if (msg.content.message_type !== 'text' || !msg.content.text) continue;
    results.push({
      providerMessageId: msg.message_id,
      providerTimestamp: new Date(msg.timestamp),
      senderId: msg.sender_id,
      body: msg.content.text,
      channel: 'TIKTOK',
    });
  }
  return results;
}
