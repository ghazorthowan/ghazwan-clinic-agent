import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { pool } from '@/lib/db';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  await pool.query(
    'UPDATE staff_users SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
    [id]
  );
  return NextResponse.json({ ok: true });
}
