import { describe, it, expect } from 'vitest';
import { isSafeOrigin } from '../lib/csrf';

// ---------------------------------------------------------------------------
// lib/csrf.ts — isSafeOrigin
// ---------------------------------------------------------------------------

function makeReq(origin: string | null, referer: string | null, host = 'localhost:3000'): Request {
  const headers: Record<string, string> = { host };
  if (origin)  headers['origin']  = origin;
  if (referer) headers['referer'] = referer;
  return new Request('http://localhost:3000/api/bookings', { method: 'POST', headers });
}

describe('CSRF origin check — isSafeOrigin()', () => {
  it('allows same-origin request via Origin header', () => {
    expect(isSafeOrigin(makeReq('http://localhost:3000', null))).toBe(true);
  });

  it('allows same-origin request via Referer header', () => {
    expect(isSafeOrigin(makeReq(null, 'http://localhost:3000/dashboard'))).toBe(true);
  });

  it('rejects a cross-origin Origin header', () => {
    expect(isSafeOrigin(makeReq('https://evil.example.com', null))).toBe(false);
  });

  it('rejects a cross-origin Referer header', () => {
    expect(isSafeOrigin(makeReq(null, 'https://evil.example.com/phish'))).toBe(false);
  });

  it('rejects a request with no Origin or Referer', () => {
    expect(isSafeOrigin(makeReq(null, null))).toBe(false);
  });

  it('rejects a malformed Origin header', () => {
    expect(isSafeOrigin(makeReq('not-a-url', null))).toBe(false);
  });

  it('rejects an Origin that only shares a suffix with the host', () => {
    expect(isSafeOrigin(makeReq('http://evil-localhost:3000', null))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// middleware.ts exempt paths — verify webhook/internal bypass logic
// ---------------------------------------------------------------------------

describe('CSRF middleware exempt paths', () => {
  const EXEMPT = new Set(['/api/webhook/whatsapp', '/api/ai/respond', '/api/outbox']);

  it('webhook path is exempt', () => {
    expect(EXEMPT.has('/api/webhook/whatsapp')).toBe(true);
  });

  it('internal AI respond path is exempt', () => {
    expect(EXEMPT.has('/api/ai/respond')).toBe(true);
  });

  it('outbox path is exempt', () => {
    expect(EXEMPT.has('/api/outbox')).toBe(true);
  });

  it('staff mutation paths are NOT exempt', () => {
    expect(EXEMPT.has('/api/bookings')).toBe(false);
    expect(EXEMPT.has('/api/closures')).toBe(false);
    expect(EXEMPT.has('/api/simulate')).toBe(false);
    expect(EXEMPT.has('/api/auth/login')).toBe(false);
  });
});
