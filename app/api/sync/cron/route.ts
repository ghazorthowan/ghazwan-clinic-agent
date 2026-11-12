import { NextRequest, NextResponse } from 'next/server';
import { syncSheets } from '@/lib/sheets';

// 55 s — safe under Vercel's 60 s serverless limit and most cron providers.
const TIMEOUT_MS = 55_000;

export async function POST(req: NextRequest) {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || req.headers.get('x-internal-secret') !== secret) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Sheets sync timed out')), TIMEOUT_MS),
  );

  try {
    const result = await Promise.race([syncSheets(), timeoutPromise]);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
