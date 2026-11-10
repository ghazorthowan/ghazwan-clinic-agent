/**
 * Unit tests for the audit logger.
 * Verifies correct SQL shape, actor_type handling, and that failures never throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audit, auditAI } from '../../lib/audit';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../../lib/db', () => ({
  pool: { query: mockQuery },
}));

describe('audit()', () => {
  beforeEach(() => { vi.clearAllMocks(); mockQuery.mockResolvedValue({ rows: [], rowCount: 1 }); });

  it('writes a STAFF entry with actor_id', async () => {
    await audit({
      actorType: 'STAFF',
      actorId: 'staff-uuid',
      action: 'CLOSURE_CREATED',
      entityType: 'closure',
      entityId: '2026-11-20',
      detail: { reason_public: 'Holiday' },
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBe('staff-uuid'); // actor_id
    expect(params[1]).toBe('STAFF');       // actor_type
    expect(params[2]).toBe('CLOSURE_CREATED');
  });

  it('writes an AI entry with null actor_id', async () => {
    await audit({
      actorType: 'AI',
      action: 'BOOKING_CANCELLED',
      entityType: 'booking',
      entityId: 'booking-uuid',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeNull();  // actor_id
    expect(params[1]).toBe('AI');
  });

  it('never throws when the DB fails', async () => {
    mockQuery.mockRejectedValue(new Error('DB down'));
    await expect(
      audit({ actorType: 'SYSTEM', action: 'MIGRATE', entityType: 'db', entityId: '007' })
    ).resolves.toBeUndefined();
  });

  it('serialises detail as JSON', async () => {
    await audit({
      actorType: 'AI',
      action: 'BOOKING_CREATED',
      entityType: 'booking',
      entityId: 'b1',
      detail: { clinicDate: '2026-11-15', bookingCode: 'GH-20261115-ABCD1234' },
    });

    const [, params] = mockQuery.mock.calls[0];
    const detail = JSON.parse(params[5]);
    expect(detail.clinicDate).toBe('2026-11-15');
  });
});

describe('auditAI()', () => {
  beforeEach(() => { vi.clearAllMocks(); mockQuery.mockResolvedValue({ rows: [], rowCount: 1 }); });

  it('calls audit with actor_type AI and null actor_id', async () => {
    await auditAI('CONVERSATION_ESCALATED', 'conversation', 'conv-uuid');
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(params[1]).toBe('AI');
    expect(params[2]).toBe('CONVERSATION_ESCALATED');
    expect(params[3]).toBe('conversation');
    expect(params[4]).toBe('conv-uuid');
  });
});
