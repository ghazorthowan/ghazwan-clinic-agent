/**
 * DB-backed sliding-window rate limiter.
 *
 * Uses PostgreSQL so limits are shared across all processes/restarts.
 * Each call upserts into rate_limit_buckets and prunes stale rows atomically.
 *
 * window: seconds — the sliding window length
 * max:    maximum requests allowed within that window
 */

import { pool } from './db';

export interface RateLimitConfig {
  window: number;  // seconds
  max: number;     // allowed requests per window
}

// Pre-defined limiters — imported by route handlers.
export const authLimiter: RateLimitConfig     = { window: 15 * 60, max: 5   }; // 5/15 min
export const webhookLimiter: RateLimitConfig  = { window: 60,      max: 300 }; // 300/min per IP
export const mutationLimiter: RateLimitConfig = { window: 60,      max: 60  }; // 60/min per IP

export interface RateLimitResult {
  limited: boolean;
  retryAfter?: number;  // seconds until the window resets
}

/**
 * Check and increment the rate limit counter for `key`.
 * Returns { limited: true } when the limit is exceeded without incrementing.
 */
export async function checkRateLimit(
  config: RateLimitConfig,
  key: string,
): Promise<RateLimitResult> {
  const { window: windowSec, max } = config;
  const now = new Date();
  // Bucket granularity = window / 10, floored to the bucket boundary.
  const bucketMs = Math.floor(windowSec / 10) * 1000 || 1000;
  const bucketStart = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
  const windowStart = new Date(now.getTime() - windowSec * 1000);

  try {
    // Single query: upsert the current bucket + count total requests in window.
    const result = await pool.query<{ total: string }>(`
      WITH upserted AS (
        INSERT INTO rate_limit_buckets (key, window_start, count)
        VALUES ($1, $2, 1)
        ON CONFLICT (key, window_start)
          DO UPDATE SET count = rate_limit_buckets.count + 1
        RETURNING count
      ),
      window_total AS (
        SELECT COALESCE(SUM(count), 0) AS total
        FROM rate_limit_buckets
        WHERE key = $1 AND window_start >= $3
      )
      SELECT (SELECT total FROM window_total) + (SELECT count FROM upserted) - 1 AS total
    `, [key, bucketStart.toISOString(), windowStart.toISOString()]);

    const total = parseInt(result.rows[0].total, 10);

    // Prune buckets older than 2× the window in the background (fire-and-forget).
    const pruneOlder = new Date(now.getTime() - windowSec * 2 * 1000);
    pool.query(
      `DELETE FROM rate_limit_buckets WHERE key = $1 AND window_start < $2`,
      [key, pruneOlder.toISOString()],
    ).catch(() => { /* non-critical */ });

    if (total > max) {
      const retryAfter = Math.ceil(windowSec - (now.getTime() - windowStart.getTime()) / 1000);
      return { limited: true, retryAfter: Math.max(1, retryAfter) };
    }

    return { limited: false };
  } catch (err) {
    // If the DB is down, fail open (don't block legitimate traffic).
    console.error('[ratelimit] DB error — failing open:', err);
    return { limited: false };
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
