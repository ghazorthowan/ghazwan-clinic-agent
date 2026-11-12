/**
 * Unit tests for Sheets sync failure alerting.
 * Mocks pool, audit, and googleapis so no real DB or API is needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockAudit } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/db', () => ({ pool: { query: mockQuery, connect: vi.fn() } }));
vi.mock('../../lib/audit', () => ({ audit: mockAudit }));
vi.mock('googleapis', () => ({ google: { auth: { JWT: vi.fn() }, sheets: vi.fn() } }));

import { drainOutbox } from '../../lib/sheets';

// Minimal pool stub that lets drainOutbox acquire/release a lock and fetch rows.
function makePoolStub(pendingIds: string[] = ['row-1']) {
  const client = {
    query: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('pg_try_advisory_lock'))  return Promise.resolve({ rows: [{ ok: true }] });
      if (sql.includes('pg_advisory_unlock'))    return Promise.resolve({ rows: [] });
      if (sql.includes('sync_outbox') && sql.includes('SELECT')) {
        return Promise.resolve({ rows: pendingIds.map(id => ({ id })) });
      }
      if (sql.includes('bookings')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      // UPDATE sync_outbox (mark synced or record error)
      return Promise.resolve({ rows: [] });
    }),
    release: vi.fn(),
  };
  return { connect: vi.fn().mockResolvedValue(client), client };
}

describe('drainOutbox failure alerting', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('records the error on outbox rows and re-throws when doSync throws', async () => {
    const { connect, client } = makePoolStub();
    const db = { connect } as never;

    await expect(
      drainOutbox(async () => { throw new Error('API quota exceeded'); }, db),
    ).rejects.toThrow('API quota exceeded');

    // The UPDATE that records the error must have been called
    const updateCall = client.query.mock.calls.find(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('UPDATE sync_outbox') && args[0].includes('error'),
    );
    expect(updateCall).toBeDefined();
    expect((updateCall as unknown[])[1]).toEqual(expect.arrayContaining([expect.stringMatching(/API quota exceeded/)]));
  });

  it('returns skipped when advisory lock is already held', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [{ ok: false }] }),
      release: vi.fn(),
    };
    const db = { connect: vi.fn().mockResolvedValue(client) } as never;

    const result = await drainOutbox(async () => {}, db);
    expect(result).toEqual({ synced: 0, skipped: 'sync already running' });
  });

  it('returns skipped:nothing pending when outbox is empty', async () => {
    const { connect } = makePoolStub([]);
    const db = { connect } as never;

    const result = await drainOutbox(async () => {}, db);
    expect(result).toEqual({ synced: 0, skipped: 'nothing pending' });
  });
});
