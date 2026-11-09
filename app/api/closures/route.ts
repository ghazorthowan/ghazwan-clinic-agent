import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { listClosures, createClosure } from '@/lib/closures';

const createInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  reason_public: z.string().min(1).max(300),
});

// GET /api/closures — any authenticated staff
export async function GET() {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await listClosures();
  return NextResponse.json(rows);
}

// POST /api/closures — ADMIN only
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createInput.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { date, reason_public } = parsed.data;
  if (date <= new Date().toISOString().slice(0, 10)) {
    return NextResponse.json({ error: 'date must be in the future' }, { status: 400 });
  }

  try {
    const record = await createClosure(date, reason_public, session.staffId);
    return NextResponse.json(record, { status: 201 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('duplicate key') || msg.includes('unique')) {
      return NextResponse.json({ error: 'closure already exists for that date' }, { status: 409 });
    }
    throw e;
  }
}
