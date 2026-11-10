/**
 * Unit tests for the DB-backed sliding-window rate limiter.
 * Mocks pool.query so no real DB is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit, getClientIp } from '../../lib/ratelimit';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../../lib/db', () => ({
  pool: { query: mockQuery },
}));

const cfg = { window: 60, max: 5 };

describe('checkRateLimit', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns limited:false when under the limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '3' }] }); // upsert+count
    mockQuery.mockResolvedValue({ rows: [] });                   // prune (fire-and-forget)

    const result = await checkRateLimit(cfg, 'test:1.2.3.4');
    expect(result.limited).toBe(false);
  });

  it('returns limited:true when at the limit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '6' }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await checkRateLimit(cfg, 'test:1.2.3.4');
    expect(result.limited).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('fails open when DB throws', async () => {
    mockQuery.mockRejectedValue(new Error('DB down'));

    const result = await checkRateLimit(cfg, 'test:1.2.3.4');
    expect(result.limited).toBe(false);
  });

  it('returns limited:false exactly at the limit boundary', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ total: '5' }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const result = await checkRateLimit(cfg, 'test:1.2.3.4');
    expect(result.limited).toBe(false);
  });
});

describe('getClientIp', () => {
  it('returns first IP from X-Forwarded-For', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    });
    expect(getClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to X-Real-IP', () => {
    const req = new Request('http://localhost/', {
      headers: { 'x-real-ip': '9.10.11.12' },
    });
    expect(getClientIp(req)).toBe('9.10.11.12');
  });

  it('returns "unknown" when no IP header present', () => {
    const req = new Request('http://localhost/');
    expect(getClientIp(req)).toBe('unknown');
  });
});
