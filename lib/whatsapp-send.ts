/**
 * Outbound WhatsApp Cloud API send.
 *
 * CLAUDE.md rule 2: "Do not invent provider API access."
 * This module is wired but will be a no-op (simulated success) until
 * real Meta credentials are present in the environment.
 *
 * CLAUDE.md rule 8: Do not message patients without explicit user approval.
 * Production sends require WHATSAPP_ENABLED=true in the environment.
 */

export interface SendResult {
  providerMessageId: string | null;
  simulated: boolean;
}

export class SendError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'SendError';
  }
}

/**
 * Send a plain-text WhatsApp message via the Meta Cloud API.
 *
 * Throws SendError on non-2xx responses so the outbox worker can
 * distinguish permanent failures (4xx) from transient ones (5xx/network).
 */
export async function sendWhatsAppMessage(
  phoneNumberId: string,
  toPhone: string,
  body: string,
): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const enabled = process.env.WHATSAPP_ENABLED === 'true';

  // Safety gate: never send real messages unless explicitly enabled.
  if (!token || !enabled) {
    return { providerMessageId: null, simulated: true };
  }

  const url = `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toPhone.replace(/^\+/, ''),
      type: 'text',
      text: { body },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SendError(`Meta API ${res.status}: ${text}`, res.status);
  }

  const data = await res.json() as { messages?: Array<{ id: string }> };
  const providerMessageId = data.messages?.[0]?.id ?? null;
  return { providerMessageId, simulated: false };
}
