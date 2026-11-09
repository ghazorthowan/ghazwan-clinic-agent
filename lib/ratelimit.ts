import { RateLimiterMemory } from 'rate-limiter-flexible';

// 5 attempts per IP per 15 minutes on auth endpoints
export const authLimiter = new RateLimiterMemory({
  points: 5,
  duration: 15 * 60,
  blockDuration: 15 * 60,
});

// 60 requests per IP per minute on general mutation endpoints
export const mutationLimiter = new RateLimiterMemory({
  points: 60,
  duration: 60,
});

export async function checkRateLimit(
  limiter: RateLimiterMemory,
  key: string
): Promise<{ limited: boolean; retryAfter?: number }> {
  try {
    await limiter.consume(key);
    return { limited: false };
  } catch (err: unknown) {
    const msBeforeNext = (err as { msBeforeNext?: number }).msBeforeNext ?? 0;
    return { limited: true, retryAfter: Math.ceil(msBeforeNext / 1000) };
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
