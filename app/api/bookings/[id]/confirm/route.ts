import { NextResponse } from 'next/server';
import { loggedIn } from '@/lib/auth';
import { transitionBooking } from '@/lib/booking';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await loggedIn()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await transitionBooking((await params).id, 'CONFIRM'));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
