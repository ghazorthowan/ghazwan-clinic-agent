import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listConversations } from '@/lib/inbox';

export async function GET() {
  const session = await getSession();
  if (!session || !session.mfaVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conversations = await listConversations();
  return NextResponse.json(conversations);
}
