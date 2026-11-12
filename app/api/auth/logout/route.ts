import { NextResponse } from 'next/server';
import { getSession, endSession } from '@/lib/auth';
import { audit } from '@/lib/audit';

export async function POST(req: Request) {
  const session = await getSession();
  await endSession();
  if (session) {
    void audit({ actorType: 'STAFF', actorId: session.staffId, action: 'LOGOUT', entityType: 'staff_user', entityId: session.staffId });
  }
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
