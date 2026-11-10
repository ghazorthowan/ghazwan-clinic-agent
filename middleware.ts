import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Paths exempt from the CSRF origin check.
 *
 * - /api/webhook/whatsapp  — Meta sends no Origin; verified by X-Hub-Signature-256 instead
 * - /api/ai/respond        — internal only; verified by x-internal-secret
 * - /api/outbox            — internal only; verified by x-internal-secret
 */
const CSRF_EXEMPT = new Set<string>([
  '/api/webhook/whatsapp',
  '/api/ai/respond',
  '/api/outbox',
]);

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (!MUTATION_METHODS.has(req.method)) return NextResponse.next();
  if (!pathname.startsWith('/api/')) return NextResponse.next();
  if (CSRF_EXEMPT.has(pathname)) return NextResponse.next();

  const host = req.headers.get('host') ?? req.nextUrl.host;
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowedHosts = new Set([
    host,
    ...extra.map(o => { try { return new URL(o).host; } catch { return ''; } }).filter(Boolean),
  ]);

  const sourceHost = (() => {
    if (origin)  { try { return new URL(origin).host;  } catch { return null; } }
    if (referer) { try { return new URL(referer).host; } catch { return null; } }
    return null;
  })();

  if (!sourceHost || !allowedHosts.has(sourceHost)) {
    return NextResponse.json(
      { error: 'Forbidden: invalid request origin' },
      { status: 403 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
