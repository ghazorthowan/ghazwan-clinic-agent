import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { setHandoff, type HandoffStatus } from '@/lib/inbox';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.mfaVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: { status?: string };
  try {
    body = await (req as Request & { json(): Promise<{ status?: string }> }).json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const status = body.status;
  if (status !== 'AI' && status !== 'HUMAN') {
    return NextResponse.json({ error: 'status must be AI or HUMAN' }, { status: 422 });
  }

  const updated = await setHandoff(id, status as HandoffStatus);
  if (!updated) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

  return NextResponse.json({ id, status });
}
