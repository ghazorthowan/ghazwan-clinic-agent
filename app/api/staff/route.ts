import { NextResponse } from 'next/server';
import { getSession, createStaffUser } from '@/lib/auth';
import { pool } from '@/lib/db';
import { z } from 'zod';

const createStaffInput = z.object({
  email: z.string().email().max(200),
  password: z.string().min(12).max(128),
  role: z.enum(['ADMIN', 'RECEPTIONIST']).default('RECEPTIONIST'),
});

// GET /api/staff — ADMIN only: list staff
export async function GET() {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const r = await pool.query(
    'SELECT id, email, role, is_active, totp_enabled, last_login_at, created_at FROM staff_users ORDER BY created_at'
  );
  return NextResponse.json(r.rows);
}

// POST /api/staff — ADMIN only: create staff account
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const parsed = createStaffInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });

  try {
    const id = await createStaffUser(parsed.data.email, parsed.data.password, parsed.data.role);
    return NextResponse.json({ id }, { status: 201 });
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (msg.includes('unique')) return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
    throw e;
  }
}
