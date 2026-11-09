/**
 * CSRF protection via origin/host enforcement.
 *
 * The session cookie is sameSite:strict, which already blocks cross-site
 * requests in modern browsers. This adds a server-side origin check as
 * defence-in-depth for older browsers and non-browser clients.
 *
 * Valid origins: same host as the request, or entries in ALLOWED_ORIGINS env var.
 */

export function isSafeOrigin(req: Request): boolean {
  const host = req.headers.get('host');
  if (!host) return false;

  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // Extra allowed origins (e.g. staging) from env
  const extra = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowedHosts = new Set([host, ...extra.map(o => {
    try { return new URL(o).host; } catch { return ''; }
  }).filter(Boolean)]);

  if (origin) {
    try {
      return allowedHosts.has(new URL(origin).host);
    } catch {
      return false;
    }
  }

  if (referer) {
    try {
      return allowedHosts.has(new URL(referer).host);
    } catch {
      return false;
    }
  }

  // No origin or referer — reject by default for mutations
  return false;
}

export function csrfError() {
  return Response.json(
    { error: 'Forbidden: invalid request origin' },
    { status: 403 }
  );
}
