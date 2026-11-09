import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { generateSecret, generateSync, verifySync, generateURI } from 'otplib';
import { pool } from '@/lib/db';
import { NextResponse } from 'next/server';

const COOKIE = 'clinic_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export type StaffRole = 'ADMIN' | 'RECEPTIONIST';

export interface SessionPayload {
  staffId: string;
  role: StaffRole;
  mfaVerified: boolean;
  expires: number;
}

export interface StaffUser {
  id: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  totp_enabled: boolean;
  totp_secret: string | null;
}

function secret(): string {
  const s = process.env.STAFF_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('STAFF_SESSION_SECRET must be at least 32 characters');
  return s;
}

function signature(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function encodeSession(payload: SessionPayload): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${data}.${signature(data)}`;
}

function decodeSession(value: string): SessionPayload | null {
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const data = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!safeEqual(signature(data), mac)) return null;
  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  try {
    const val = (await cookies()).get(COOKIE)?.value;
    if (!val) return null;
    const payload = decodeSession(val);
    if (!payload || Date.now() > payload.expires) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function loggedIn(): Promise<boolean> {
  const s = await getSession();
  return s !== null && s.mfaVerified;
}

export async function startSession(payload: Omit<SessionPayload, 'expires'>): Promise<void> {
  const full: SessionPayload = { ...payload, expires: Date.now() + SESSION_TTL_MS };
  (await cookies()).set(COOKIE, encodeSession(full), {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

// --- Staff DB helpers ---

export async function findStaffByEmail(email: string): Promise<StaffUser | null> {
  const r = await pool.query<StaffUser>(
    'SELECT id, email, role, is_active, totp_enabled, totp_secret FROM staff_users WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  return r.rows[0] ?? null;
}

export async function verifyStaffPassword(user: StaffUser & { password_hash: string }, password: string): Promise<boolean> {
  return compare(password, user.password_hash);
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function updateLastLogin(staffId: string): Promise<void> {
  await pool.query('UPDATE staff_users SET last_login_at = now() WHERE id = $1', [staffId]);
}

// --- TOTP helpers ---

export function generateTotpSecret(): string {
  return generateSecret();
}

export function totpUri(email: string, secret: string): string {
  const result = generateURI({ label: email, issuer: 'GhazwanClinic', secret });
  return typeof result === 'string' ? result : String(result);
}

export function verifyTotp(secret: string, token: string): boolean {
  try {
    const result = verifySync({ token, secret });
    return typeof result === 'object' ? (result as { valid: boolean }).valid : Boolean(result);
  } catch {
    return false;
  }
}

export async function enableTotp(staffId: string, secret: string): Promise<void> {
  await pool.query(
    'UPDATE staff_users SET totp_secret = $1, totp_enabled = true, updated_at = now() WHERE id = $2',
    [secret, staffId]
  );
}

// --- RBAC helper for route handlers ---

type RouteHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;

export function requireAuth(role?: StaffRole) {
  return function withAuth(handler: RouteHandler): RouteHandler {
    return async function (req, ctx) {
      const session = await getSession();
      if (!session || !session.mfaVerified) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (role && session.role !== role) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return handler(req, ctx);
    };
  };
}

// --- Seed helper: create first admin ---

export async function createStaffUser(
  email: string,
  password: string,
  role: StaffRole = 'RECEPTIONIST'
): Promise<string> {
  const password_hash = await hashPassword(password);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO staff_users (email, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, updated_at = now()
     RETURNING id`,
    [email.toLowerCase().trim(), password_hash, role]
  );
  return r.rows[0].id;
}

// Legacy: kept so existing env-var based dev flow still works during transition
export function validateStaffPassword(password: string): boolean {
  const expected = process.env.STAFF_PASSWORD;
  return !!expected && expected.length >= 12 && safeEqual(password, expected);
}
