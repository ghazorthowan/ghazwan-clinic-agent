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
  status: z.enum(['AI', 'HUMAN', 'OPEN']).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
}).refine(
  d => d.status !== undefined || d.assigned_to !== undefined,
  { message: 'At least one of status or assigned_to is required' },
);

/**
 * PATCH /api/inbox/:id — staff pauses/resumes AI or assigns a conversation.
 *
 * status=HUMAN  — staff takes over; AI will not auto-respond.
 * status=AI     — hand back to AI.
 * status=OPEN   — open/unassigned state (AI still responds).
 * assigned_to   — UUID of a staff member (or null to unassign).
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

  const { status, assigned_to } = parsed.data;

  // Build dynamic SET clause
  const setClauses: string[] = ['updated_at = now()'];
  const values: unknown[] = [];

  if (status !== undefined) {
    values.push(status);
    setClauses.push(`status = $${values.length}`);
  }
  if (assigned_to !== undefined) {
    values.push(assigned_to); // null clears assignment
    setClauses.push(`assigned_to = $${values.length}`);
  }

  values.push(id);
  const idParam = `$${values.length}`;

  const r = await pool.query<{ id: string; status: string; assigned_to: string | null }>(
    `UPDATE conversations SET ${setClauses.join(', ')}
     WHERE id = ${idParam}
     RETURNING id, status, assigned_to`,
    values,
  );

  if (!r.rows.length) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (status !== undefined) {
    const action = status === 'HUMAN' ? 'CONVERSATION_PAUSED' : 'CONVERSATION_RESUMED';
    void audit({
      actorType: 'STAFF',
      actorId: session.staffId,
      action,
      entityType: 'conversation',
      entityId: id,
      detail: { status },
    });
  }

  if (assigned_to !== undefined) {
    void audit({
      actorType: 'STAFF',
      actorId: session.staffId,
      action: 'CONVERSATION_ASSIGNED',
      entityType: 'conversation',
      entityId: id,
      detail: { assigned_to },
    });
  }

  return NextResponse.json(r.rows[0]);
}
