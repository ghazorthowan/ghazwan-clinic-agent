import { NextResponse } from 'next/server';
import { findStaffByEmail, verifyStaffPassword, startSession, updateLastLogin } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { pool } from '@/lib/db';
import { authLimiter, checkRateLimit, getClientIp } from '@/lib/ratelimit';

const MAX_FAILED = 10;
const LOCKOUT_MINUTES = 60;

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { limited, retryAfter } = await checkRateLimit(authLimiter, `login:${ip}`);
  if (limited) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } }
    );
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const row = await pool.query<{
      id: string; email: string; role: string; is_active: boolean;
      totp_enabled: boolean; totp_secret: string | null;
      password_hash: string; failed_attempts: number; locked_until: Date | null;
    }>(
      'SELECT id, email, role, is_active, totp_enabled, totp_secret, password_hash, failed_attempts, locked_until FROM staff_users WHERE email = $1',
      [body.email.toLowerCase().trim()]
    );
    const user = row.rows[0];

    // Constant-time failure path
    const dummyHash = '$2b$12$invalidhashfortimingXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const passwordOk = user
      ? await verifyStaffPassword(user as never, body.password)
      : (await import('bcryptjs').then(m => m.compare(body.password, dummyHash)), false);

    if (!user || !user.is_active) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Check lockout
    if (user.locked_until && new Date() < new Date(user.locked_until)) {
      return NextResponse.json({ error: 'Account temporarily locked. Try again later.' }, { status: 401 });
    }

    if (!passwordOk) {
      const newFailed = user.failed_attempts + 1;
      const lockUntil = newFailed >= MAX_FAILED
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;
      await pool.query(
        'UPDATE staff_users SET failed_attempts = $1, locked_until = $2, updated_at = now() WHERE id = $3',
        [newFailed, lockUntil, user.id]
      );
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    // Successful password — reset failure counter
    await pool.query(
      'UPDATE staff_users SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE id = $1',
      [user.id]
    );

    if (user.totp_enabled) {
      await startSession({ staffId: user.id, role: user.role as 'ADMIN' | 'RECEPTIONIST', mfaVerified: false });
      return NextResponse.json({ mfaRequired: true });
    }

    await startSession({ staffId: user.id, role: user.role as 'ADMIN' | 'RECEPTIONIST', mfaVerified: true });
    await updateLastLogin(user.id);
    void audit({ actorType: 'STAFF', actorId: user.id, action: 'LOGIN', entityType: 'staff_user', entityId: user.id });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
