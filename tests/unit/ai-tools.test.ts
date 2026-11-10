/**
 * Unit tests for AI tool definitions and dispatcher safety guards.
 *
 * These tests run without a database or real API key — they verify that:
 * - Tool schemas are well-formed (required fields, additionalProperties: false)
 * - The dispatcher rejects unknown tool names
 * - Date validation rejects malformed inputs before hitting the DB
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AI_TOOLS, dispatchTool, clinicDayInfo, bookAppointment } from '../../lib/ai-tools';

// ---------------------------------------------------------------------------
// Mock the DB, policy, and booking modules so no real DB is needed
// ---------------------------------------------------------------------------

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../../lib/db', () => ({
  pool: { query: mockQuery },
}));

vi.mock('../../lib/policy', () => ({
  clinicHours: vi.fn().mockReturnValue('17:00-20:00'),
  isPastClinicDate: vi.fn().mockReturnValue(false),
}));

vi.mock('../../lib/booking', () => ({
  transitionBooking: vi.fn().mockResolvedValue({ status: 'CANCELLED' }),
}));

// ---------------------------------------------------------------------------
// Tool schema validation
// ---------------------------------------------------------------------------

describe('AI_TOOLS schema', () => {
  const toolNames = AI_TOOLS.map(t => t.name);

  it('includes all four allow-listed tools', () => {
    expect(toolNames).toContain('clinic_day_info');
    expect(toolNames).toContain('book_appointment');
    expect(toolNames).toContain('cancel_booking');
    expect(toolNames).toContain('escalate_to_human');
  });

  it('every tool has additionalProperties: false', () => {
    for (const tool of AI_TOOLS) {
      expect((tool.input_schema as unknown as { additionalProperties: boolean }).additionalProperties)
        .toBe(false);
    }
  });

  it('every tool has required fields listed', () => {
    for (const tool of AI_TOOLS) {
      const schema = tool.input_schema as { required: string[] };
      expect(Array.isArray(schema.required)).toBe(true);
      expect(schema.required.length).toBeGreaterThan(0);
    }
  });

  it('every tool has strict: true', () => {
    for (const tool of AI_TOOLS) {
      expect(tool.strict).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Date validation guard
// ---------------------------------------------------------------------------

describe('clinicDayInfo date validation', () => {
  beforeEach(() => {
    mockQuery.mockResolvedValue({ rows: [{ confirmed: '0', awaiting: '0' }], rowCount: 0 });
  });

  it('throws on a non-date string', async () => {
    await expect(clinicDayInfo('tomorrow')).rejects.toThrow('Invalid date format');
  });

  it('throws on a partial date', async () => {
    await expect(clinicDayInfo('2026-11')).rejects.toThrow('Invalid date format');
  });

  it('throws on an empty string', async () => {
    await expect(clinicDayInfo('')).rejects.toThrow('Invalid date format');
  });

  it('succeeds for a valid YYYY-MM-DD date', async () => {
    const info = await clinicDayInfo('2026-11-15');
    expect(info.date).toBe('2026-11-15');
    expect(typeof info.isOpen).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// bookAppointment
// ---------------------------------------------------------------------------

describe('bookAppointment', () => {
  it('throws on invalid date format', async () => {
    await expect(bookAppointment('contact-uuid', 'next-week')).rejects.toThrow('Invalid date format');
  });

  it('throws when contact is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // contact lookup
    await expect(bookAppointment('missing-uuid', '2026-11-15')).rejects.toThrow('Contact not found');
  });

  it('returns booking details on success', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'contact-uuid' }], rowCount: 1 }) // contact lookup
      .mockResolvedValueOnce({                                                  // insert
        rows: [{ id: 'booking-uuid', booking_code: 'BC001', status: 'AWAITING_PATIENT' }],
        rowCount: 1,
      });
    const result = await bookAppointment('contact-uuid', '2026-11-15');
    expect(result).toMatchObject({ bookingId: 'booking-uuid', bookingCode: 'BC001', status: 'AWAITING_PATIENT' });
  });
});

// ---------------------------------------------------------------------------
// Dispatcher safety
// ---------------------------------------------------------------------------

describe('dispatchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [{ confirmed: '0', awaiting: '0' }], rowCount: 0 });
  });

  it('throws for an unknown tool name', async () => {
    await expect(
      dispatchTool('drop_table', { table: 'bookings' })
    ).rejects.toThrow('Unknown tool: drop_table');
  });

  it('throws for an empty tool name', async () => {
    await expect(dispatchTool('', {})).rejects.toThrow('Unknown tool:');
  });

  it('calls clinic_day_info with the date param', async () => {
    const result = await dispatchTool('clinic_day_info', { date: '2026-11-15' });
    expect(result).toMatchObject({ date: '2026-11-15' });
  });

  it('calls book_appointment and returns a booking code', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'contact-uuid' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ id: 'booking-uuid', booking_code: 'BC001', status: 'AWAITING_PATIENT' }],
        rowCount: 1,
      });
    const result = await dispatchTool('book_appointment', {
      contact_id: 'contact-uuid',
      clinic_date: '2026-11-15',
    });
    expect(result).toMatchObject({ bookingCode: 'BC001', status: 'AWAITING_PATIENT' });
  });

  it('calls cancel_booking and returns success', async () => {
    const result = await dispatchTool('cancel_booking', {
      booking_id: 'booking-uuid',
      idempotency_key: 'cancel:booking-uuid:msg001',
    });
    expect(result).toMatchObject({ success: true, status: 'CANCELLED' });
  });

  it('calls escalate_to_human and returns escalated: true', async () => {
    const result = await dispatchTool('escalate_to_human', {
      conversation_id: 'conv-uuid',
    });
    expect(result).toMatchObject({ escalated: true });
  });
});
