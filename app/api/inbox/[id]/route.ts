import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getMessages } from '@/lib/inbox';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || !session.mfaVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const messages = await getMessages(id);
  return NextResponse.json(messages);
}
