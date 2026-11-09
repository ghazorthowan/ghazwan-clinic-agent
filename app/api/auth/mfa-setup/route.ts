import { NextResponse } from 'next/server';
import { getSession, generateTotpSecret, totpUri, verifyTotp, enableTotp } from '@/lib/auth';
import { pool } from '@/lib/db';

// GET — generate a new TOTP secret and return QR URI for the signed-in user
export async function GET() {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await pool.query<{ email: string }>('SELECT email FROM staff_users WHERE id = $1', [session.staffId]);
  const user = r.rows[0];
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const totpSecret = generateTotpSecret();
  // Store pending secret (not yet enabled) so the confirm step can verify it
  await pool.query(
    'UPDATE staff_users SET totp_secret = $1, totp_enabled = false, updated_at = now() WHERE id = $2',
    [totpSecret, session.staffId]
  );

  return NextResponse.json({ uri: totpUri(user.email, totpSecret) });
}

// POST { token } — confirm the first TOTP code to activate MFA
export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !session.mfaVerified) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body.token !== 'string') return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const r = await pool.query<{ totp_secret: string | null }>(
    'SELECT totp_secret FROM staff_users WHERE id = $1',
    [session.staffId]
  );
  const secret = r.rows[0]?.totp_secret;
  if (!secret) return NextResponse.json({ error: 'No pending MFA setup' }, { status: 400 });

  if (!verifyTotp(secret, body.token.replace(/\s/g, ''))) {
    return NextResponse.json({ error: 'Invalid token — scan the QR again and retry' }, { status: 400 });
  }

  await enableTotp(session.staffId, secret);
  return NextResponse.json({ ok: true });
}
