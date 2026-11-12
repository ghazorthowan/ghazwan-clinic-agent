import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { pool } from '@/lib/db';

const patchInput = z.object({
  is_active: z.boolean().optional(),
  role: z.enum(['ADMIN', 'RECEPTIONIST']).optional(),
}).refine(d => d.is_active !== undefined || d.role !== undefined, {
  message: 'Provide at least one of is_active or role',
});

type Ctx = { params: Promise<{ id: string }> };

// GET /api/staff/:id — ADMIN only
export async function GET(_req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const r = await pool.query(
    'SELECT id, email, role, is_active, totp_enabled, last_login_at, created_at, updated_at FROM staff_users WHERE id = $1',
    [id],
  );
  if (!r.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(r.rows[0]);
}

// PATCH /api/staff/:id — ADMIN only: deactivate/reactivate, change role
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;

  const parsed = patchInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  // Prevent an admin from deactivating or demoting themselves.
  if (id === session.staffId && (parsed.data.is_active === false || parsed.data.role === 'RECEPTIONIST')) {
    return NextResponse.json({ error: 'Cannot deactivate or demote your own account' }, { status: 422 });
  }

  const existing = await pool.query<{ id: string; email: string; role: string; is_active: boolean }>(
    'SELECT id, email, role, is_active FROM staff_users WHERE id = $1',
    [id],
  );
  if (!existing.rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const setClauses: string[] = ['updated_at = now()'];
  const values: unknown[] = [];

  if (parsed.data.is_active !== undefined) {
    values.push(parsed.data.is_active);
    setClauses.push(`is_active = $${values.length}`);
  }
  if (parsed.data.role !== undefined) {
    values.push(parsed.data.role);
    setClauses.push(`role = $${values.length}`);
  }

  values.push(id);
  const r = await pool.query(
    `UPDATE staff_users SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING id, email, role, is_active`,
    values,
  );

  const updated = r.rows[0];
  const action = parsed.data.is_active === false
    ? 'STAFF_DEACTIVATED'
    : parsed.data.is_active === true
      ? 'STAFF_REACTIVATED'
      : 'STAFF_ROLE_CHANGED';

  void audit({
    actorType: 'STAFF',
    actorId: session.staffId,
    action,
    entityType: 'staff_user',
    entityId: id,
    detail: { email: existing.rows[0].email, changes: parsed.data },
  });

  return NextResponse.json(updated);
}
