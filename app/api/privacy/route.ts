/**
 * Privacy notice and consent API.
 *
 * GET  /api/privacy  — returns the bilingual privacy notice text
 * POST /api/privacy  — records explicit consent for a contact
 *
 * CLAUDE.md rule 1: patients receive privacy disclosure before data processing.
 * CLAUDE.md rule 8: consent is never assumed — only explicitly recorded here.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PRIVACY_NOTICE, recordConsent, eraseContactData, ERASURE_CONFIRMATION } from '@/lib/consent';
import { getClientIp } from '@/lib/ratelimit';
import { audit } from '@/lib/audit';

// ---------------------------------------------------------------------------
// GET — return the privacy notice text
// ---------------------------------------------------------------------------

export async function GET() {
  return NextResponse.json({ notice: PRIVACY_NOTICE });
}

// ---------------------------------------------------------------------------
// POST — record consent or erasure for a contact
// ---------------------------------------------------------------------------

const consentInput = z.object({
  contactId: z.string().uuid(),
  action: z.enum(['consent', 'erase']),
  channel: z.string().min(1).max(64).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = consentInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { contactId, action, channel } = parsed.data;
  const ip = getClientIp(req);
  const channelLabel = channel ?? ip;

  if (action === 'consent') {
    await recordConsent(contactId, channelLabel);
    void audit({
      actorType: 'SYSTEM',
      action: 'CONSENT_RECORDED',
      entityType: 'contact',
      entityId: contactId,
      detail: { channel: channelLabel },
    });
    return NextResponse.json({ ok: true, action: 'consent' });
  }

  // action === 'erase'
  await eraseContactData(contactId);
  void audit({
    actorType: 'SYSTEM',
    action: 'DATA_ERASED',
    entityType: 'contact',
    entityId: contactId,
    detail: { channel: channelLabel },
  });
  return NextResponse.json({ ok: true, action: 'erase', message: ERASURE_CONFIRMATION });
}
