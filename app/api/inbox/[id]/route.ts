import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { pool } from '@/lib/db';
import { getMessages } from '@/lib/inbox';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session || !session.mfaVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const messages = await getMessages(id);
  return NextResponse.json(messages);
}

const patchInput = z.object({
  status: z.enum(['AI', 'HUMAN', 'OPEN']),
});

/**
 * PATCH /api/inbox/:id — staff pauses or resumes AI on a conversation.
 *
 * status=HUMAN  — staff takes over; AI will not auto-respond.
 * status=AI     — hand back to AI.
 * status=OPEN   — open/unassigned state (AI still responds).
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session || !session.mfaVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const parsed = patchInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const r = await pool.query<{ id: string; status: string }>(
    `UPDATE conversations SET status = $1, updated_at = now()
     WHERE id = $2
     RETURNING id, status`,
    [parsed.data.status, id],
  );

  if (!r.rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const action = parsed.data.status === 'HUMAN' ? 'CONVERSATION_PAUSED' : 'CONVERSATION_RESUMED';
  void audit({
    actorType: 'STAFF',
    actorId: session.staffId,
    action,
    entityType: 'conversation',
    entityId: id,
    detail: { status: parsed.data.status },
  });

  return NextResponse.json(r.rows[0]);
}
