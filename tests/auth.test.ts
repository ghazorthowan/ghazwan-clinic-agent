import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from 'node:crypto';
import { generateSecret, generateSync, verifySync, generateURI } from 'otplib';

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function makeTotpSecret() { return generateSecret(); }

function verifyTotp(secret: string, token: string): boolean {
  try {
    const r = verifySync({ token, secret });
    return typeof r === 'object' ? (r as { valid: boolean }).valid : Boolean(r);
  } catch { return false; }
}

function totpUri(email: string, secret: string): string {
  const r = generateURI({ label: email, issuer: 'GhazwanClinic', secret });
  return typeof r === 'string' ? r : String(r);
}

describe('safeEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });
  it('returns false for different strings of same length', () => {
    expect(safeEqual('abc', 'abd')).toBe(false);
  });
  it('returns false for different lengths', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('TOTP', () => {
  it('generates a secret and verifies a valid token', () => {
    const secret = makeTotpSecret();
    expect(secret.length).toBeGreaterThan(10);
    const token = generateSync({ secret }) as string;
    expect(verifyTotp(secret, token)).toBe(true);
  });

  it('rejects an invalid token', () => {
    const secret = makeTotpSecret();
    expect(verifyTotp(secret, '000000')).toBe(false);
  });

  it('produces a valid otpauth URI', () => {
    const secret = makeTotpSecret();
    const uri = totpUri('staff@clinic.local', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('GhazwanClinic');
  });
});
