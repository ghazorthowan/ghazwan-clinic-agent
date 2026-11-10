import { NextRequest, NextResponse } from 'next/server';
import { loggedIn } from '@/lib/auth';
import { createBooking, BookingError, listBookings } from '@/lib/booking';
import { bookingInput } from '@/lib/schema';
import { mutationLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';

export async function GET() {
  if (!await loggedIn()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json(await listBookings());
}

export async function POST(req: NextRequest) {
  if (!await loggedIn()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { limited, retryAfter } = await checkRateLimit(mutationLimiter, `booking:${getClientIp(req)}`);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }
  try {
    const input = bookingInput.parse(await req.json());
    return NextResponse.json(await createBooking(input), { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof BookingError ? e.message : 'Invalid request' }, { status: 400 });
  }
}
