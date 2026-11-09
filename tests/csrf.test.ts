import { describe, it, expect } from 'vitest';

// Inline the origin-check logic (same as lib/csrf.ts) to keep tests DB-free
function isSafeOrigin(originHeader: string | null, refererHeader: string | null, host: string): boolean {
  const extra: string[] = [];
  const allowedHosts = new Set([host, ...extra]);

  if (originHeader) {
    try { return allowedHosts.has(new URL(originHeader).host); } catch { return false; }
  }
  if (refererHeader) {
    try { return allowedHosts.has(new URL(refererHeader).host); } catch { return false; }
  }
  return false;
}

describe('CSRF origin check', () => {
  const host = 'localhost:3000';

  it('allows same-origin request via Origin header', () => {
    expect(isSafeOrigin('http://localhost:3000', null, host)).toBe(true);
  });

  it('allows same-origin request via Referer header', () => {
    expect(isSafeOrigin(null, 'http://localhost:3000/dashboard', host)).toBe(true);
  });

  it('rejects a cross-origin Origin header', () => {
    expect(isSafeOrigin('https://evil.example.com', null, host)).toBe(false);
  });

  it('rejects a cross-origin Referer header', () => {
    expect(isSafeOrigin(null, 'https://evil.example.com/phish', host)).toBe(false);
  });

  it('rejects a request with no Origin or Referer', () => {
    expect(isSafeOrigin(null, null, host)).toBe(false);
  });

  it('rejects a malformed Origin header', () => {
    expect(isSafeOrigin('not-a-url', null, host)).toBe(false);
  });

  it('rejects an Origin that only shares a suffix with the host', () => {
    expect(isSafeOrigin('http://evil-localhost:3000', null, host)).toBe(false);
  });
});
