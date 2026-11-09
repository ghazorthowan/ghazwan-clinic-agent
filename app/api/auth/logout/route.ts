import { NextResponse } from 'next/server';
import { endSession } from '@/lib/auth';
export async function POST(req: Request) {
  await endSession();
  return NextResponse.redirect(new URL('/login', req.url), { status: 303 });
}
