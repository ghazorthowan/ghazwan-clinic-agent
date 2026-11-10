/**
 * Unit tests for the outbox worker and WhatsApp send helper.
 * No real DB or Meta API — everything is mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendWhatsAppMessage, SendError } from '../../lib/whatsapp-send';

// ---------------------------------------------------------------------------
// sendWhatsAppMessage
// ---------------------------------------------------------------------------

describe('sendWhatsAppMessage', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns simulated:true when WHATSAPP_ENABLED is not set', async () => {
    vi.stubEnv('WHATSAPP_ENABLED', '');
    vi.stubEnv('WHATSAPP_TOKEN', 'tok');
    const result = await sendWhatsAppMessage('phoneId', '+9647001234567', 'hello');
    expect(result.simulated).toBe(true);
    expect(result.providerMessageId).toBeNull();
  });

  it('returns simulated:true when WHATSAPP_TOKEN is not set', async () => {
    vi.stubEnv('WHATSAPP_ENABLED', 'true');
    vi.stubEnv('WHATSAPP_TOKEN', '');
    const result = await sendWhatsAppMessage('phoneId', '+9647001234567', 'hello');
    expect(result.simulated).toBe(true);
  });

  it('returns providerMessageId on success', async () => {
    vi.stubEnv('WHATSAPP_ENABLED', 'true');
    vi.stubEnv('WHATSAPP_TOKEN', 'tok');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.123' }] }),
    } as Response);

    const result = await sendWhatsAppMessage('phoneId', '+9647001234567', 'hello');
    expect(result.simulated).toBe(false);
    expect(result.providerMessageId).toBe('wamid.123');
  });

  it('throws SendError with statusCode on non-2xx response', async () => {
    vi.stubEnv('WHATSAPP_ENABLED', 'true');
    vi.stubEnv('WHATSAPP_TOKEN', 'tok');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"error":"bad request"}',
    } as unknown as Response);

    await expect(
      sendWhatsAppMessage('phoneId', '+9647001234567', 'hello')
    ).rejects.toThrow(SendError);

    try {
      await sendWhatsAppMessage('phoneId', '+9647001234567', 'hello');
    } catch (e) {
      expect(e instanceof SendError).toBe(true);
      expect((e as SendError).statusCode).toBe(400);
    }
  });

  it('strips leading + from phone number in request', async () => {
    vi.stubEnv('WHATSAPP_ENABLED', 'true');
    vi.stubEnv('WHATSAPP_TOKEN', 'tok');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.abc' }] }),
    } as Response);
    global.fetch = mockFetch;

    await sendWhatsAppMessage('phoneId', '+9647001234567', 'hello');
    const body = JSON.parse((mockFetch.mock.calls[0][1] as RequestInit).body as string);
    expect(body.to).toBe('9647001234567');
  });
});
