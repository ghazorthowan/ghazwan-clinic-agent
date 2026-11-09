import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { deleteClosure } from '@/lib/closures';

// DELETE /api/closures/:date — ADMIN only
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'invalid date format' }, { status: 400 });
  }

  const deleted = await deleteClosure(date, session.staffId);
  if (!deleted) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
