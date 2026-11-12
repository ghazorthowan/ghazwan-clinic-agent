import { createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify the X-Hub-Signature-256 header Meta sends on every webhook POST.
 * Returns true only when the signature matches the raw body bytes.
 */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');
  const received = signatureHeader.slice('sha256='.length);
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Meta webhook payload types (subset we care about)
// ---------------------------------------------------------------------------

export interface MetaTextMessage {
  id: string;        // provider_message_id
  from: string;      // sender WA phone number (E.164 without +)
  timestamp: string; // unix seconds as string
  type: 'text';
  text: { body: string };
}

export interface MetaChange {
  value: {
    messaging_product: string;
    metadata: { phone_number_id: string; display_phone_number: string };
    contacts?: Array<{ profile: { name: string }; wa_id: string }>;
    messages?: MetaTextMessage[];
    statuses?: Array<{ id: string; status: string; timestamp: string }>;
  };
  field: string;
}

export interface MetaWebhookPayload {
  object: string;
  entry: Array<{ id: string; changes: MetaChange[] }>;
}

// ---------------------------------------------------------------------------
// Normalized inbound event
// ---------------------------------------------------------------------------

export interface NormalizedInbound {
  providerMessageId: string;
  providerTimestamp: Date;
  fromPhone: string;       // E.164 with leading +
  displayName: string;
  body: string;
  phoneNumberId: string;   // which WA number received it
}

/**
 * Extract all inbound text messages from a Meta webhook payload.
 * Delivery status updates and non-text messages are silently skipped —
 * we log them separately but do not process them.
 */
export function normalizeInbound(payload: MetaWebhookPayload): NormalizedInbound[] {
  if (payload.object !== 'whatsapp_business_account') return [];

  const results: NormalizedInbound[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      const { value } = change;
      if (!value.messages?.length) continue;

      const phoneNumberId = value.metadata.phone_number_id;
      const contactMap = new Map(
        (value.contacts ?? []).map(c => [c.wa_id, c.profile.name]),
      );

      for (const msg of value.messages) {
        if (msg.type !== 'text') continue;
        results.push({
          providerMessageId: msg.id,
          providerTimestamp: new Date(Number(msg.timestamp) * 1000),
          fromPhone: `+${msg.from}`,
          displayName: contactMap.get(msg.from) ?? msg.from,
          body: msg.text.body,
          phoneNumberId,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Delivery status normalization
// ---------------------------------------------------------------------------

export interface NormalizedStatus {
  id: string;        // provider_message_id of the outbound message
  status: string;    // 'sent' | 'delivered' | 'read' | 'failed'
  timestamp: string; // unix seconds as string
}

/**
 * Extract delivery/read status updates from a Meta webhook payload.
 * These are informational — they never create new messages.
 */
export function normalizeStatuses(payload: MetaWebhookPayload): NormalizedStatus[] {
  if (payload.object !== 'whatsapp_business_account') return [];
  const results: NormalizedStatus[] = [];
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'messages') continue;
      for (const s of change.value.statuses ?? []) {
        results.push({ id: s.id, status: s.status, timestamp: s.timestamp });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// 24-hour messaging window
// ---------------------------------------------------------------------------

/**
 * Returns true when the clinic is within the 24-hour window to reply
 * to this contact (Meta policy: can only send free-form text within 24h
 * of the last inbound message; must use approved templates outside the window).
 */
export function isWithinWindow(windowExpiresAt: Date | null): boolean {
  if (!windowExpiresAt) return false;
  return windowExpiresAt > new Date();
}

/** Compute the new window expiry from an inbound message timestamp. */
export function newWindowExpiry(providerTimestamp: Date): Date {
  return new Date(providerTimestamp.getTime() + 24 * 60 * 60 * 1000);
}
