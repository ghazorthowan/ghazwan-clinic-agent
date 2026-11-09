import { NextResponse } from 'next/server';
import { getSession, startSession, updateLastLogin, verifyTotp } from '@/lib/auth';
import { pool } from '@/lib/db';
import { authLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { limited, retryAfter } = await checkRateLimit(authLimiter, `mfa:${ip}`);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  try {
    const session = await getSession();
    if (!session || session.mfaVerified) {
      return NextResponse.json({ error: 'No pending MFA session' }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.token !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const r = await pool.query<{ totp_secret: string | null; is_active: boolean }>(
      'SELECT totp_secret, is_active FROM staff_users WHERE id = $1',
      [session.staffId]
    );
    const user = r.rows[0];
    if (!user || !user.is_active || !user.totp_secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!verifyTotp(user.totp_secret, body.token.replace(/\s/g, ''))) {
      return NextResponse.json({ error: 'Invalid MFA token' }, { status: 401 });
    }

    await startSession({ staffId: session.staffId, role: session.role, mfaVerified: true });
    await updateLastLogin(session.staffId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
