/**
 * Allow-listed AI tool implementations.
 *
 * CLAUDE.md rule 6: "No direct SQL or arbitrary message-sending tool access
 * for the language model. All AI actions use validated, allow-listed commands."
 */

import { pool } from './db';
import { clinicHours, isPastClinicDate } from './policy';
import { transitionBooking } from './booking';
import { auditAI } from './audit';
import type Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// clinic_day_info — read-only lookup
// ---------------------------------------------------------------------------

export interface ClinicDayInfo {
  date: string;
  isOpen: boolean;
  closureReason: string | null;
  confirmedCount: number;
  awaitingCount: number;
}

export async function clinicDayInfo(date: string): Promise<ClinicDayInfo> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}`);
  }

  const hours = clinicHours(date);
  const isPast = isPastClinicDate(date);

  const closureRow = await pool.query<{ reason_public: string }>(
    `SELECT reason_public FROM clinic_closures WHERE closure_date = $1 AND deleted_at IS NULL`,
    [date],
  );

  const bookingRow = await pool.query<{ confirmed: string; awaiting: string }>(`
    SELECT
      count(*) FILTER (WHERE status = 'CONFIRMED') AS confirmed,
      count(*) FILTER (WHERE status = 'AWAITING_PATIENT') AS awaiting
    FROM bookings
    WHERE clinic_date = $1 AND status IN ('AWAITING_PATIENT','CONFIRMED','NEEDS_STAFF')
  `, [date]);

  const { confirmed, awaiting } = bookingRow.rows[0];

  return {
    date,
    isOpen: !!hours && !isPast && closureRow.rowCount === 0,
    closureReason: closureRow.rows[0]?.reason_public ?? null,
    confirmedCount: parseInt(confirmed, 10),
    awaitingCount: parseInt(awaiting, 10),
  };
}

// ---------------------------------------------------------------------------
// book_appointment — create a booking for an existing contact
// ---------------------------------------------------------------------------

export interface BookAppointmentResult {
  bookingId: string;
  bookingCode: string;
  status: string;
}

export async function bookAppointment(
  contactId: string,
  clinicDate: string,
): Promise<BookAppointmentResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clinicDate)) {
    throw new Error(`Invalid date format: ${clinicDate}`);
  }

  // Look up the contact to verify it exists
  const contactRow = await pool.query<{ id: string }>(
    `SELECT id FROM contacts WHERE id = $1 AND deleted_at IS NULL`,
    [contactId],
  );
  if (!contactRow.rows.length) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  // Insert the booking directly (contact already exists from inbound webhook)
  const result = await pool.query<{ id: string; booking_code: string; status: string }>(`
    INSERT INTO bookings (contact_id, clinic_date, source_channel, status)
    VALUES ($1, $2, 'WHATSAPP', 'AWAITING_PATIENT')
    RETURNING id, booking_code, status
  `, [contactId, clinicDate]);

  const row = result.rows[0];
  await auditAI('BOOKING_CREATED', 'booking', row.id, { contactId, clinicDate, bookingCode: row.booking_code });
  return { bookingId: row.id, bookingCode: row.booking_code, status: row.status };
}

// ---------------------------------------------------------------------------
// cancel_booking — patient-initiated cancellation
// ---------------------------------------------------------------------------

export async function cancelBooking(
  bookingId: string,
  idempotencyKey: string,
): Promise<{ success: boolean; status: string }> {
  const result = await transitionBooking(bookingId, 'CANCEL', idempotencyKey);
  await auditAI('BOOKING_CANCELLED', 'booking', bookingId, { idempotencyKey, status: result.status });
  return { success: true, status: result.status };
}

// ---------------------------------------------------------------------------
// escalate_to_human — flag conversation for staff takeover
// ---------------------------------------------------------------------------

export async function escalateToHuman(conversationId: string): Promise<{ escalated: boolean }> {
  await pool.query(
    `UPDATE conversations SET status = 'HUMAN' WHERE id = $1`,
    [conversationId],
  );
  await auditAI('CONVERSATION_ESCALATED', 'conversation', conversationId);
  return { escalated: true };
}

// ---------------------------------------------------------------------------
// Tool definitions for the Claude API (allow-list)
// ---------------------------------------------------------------------------

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: 'clinic_day_info',
    description:
      'Look up whether the clinic is open on a specific date and how many bookings it already has. ' +
      'Use this before creating a booking or when answering availability questions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format (e.g. 2026-11-15).',
        },
      },
      required: ['date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'book_appointment',
    description:
      "Book an appointment for a patient who has EXPLICITLY confirmed they want to book. " +
      'Do NOT call this until the patient has said yes in words (e.g. "نعم", "أريد", "أحجز", "yes", "book it"). ' +
      'Check clinic_day_info first to confirm the date is open.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contact_id: {
          type: 'string',
          description: 'UUID of the patient contact record.',
        },
        clinic_date: {
          type: 'string',
          description: 'Date to book in YYYY-MM-DD format.',
        },
      },
      required: ['contact_id', 'clinic_date'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'cancel_booking',
    description:
      "Cancel an existing booking at the patient's explicit request. " +
      'Requires the booking_id and a unique idempotency_key to prevent double-cancellations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        booking_id: {
          type: 'string',
          description: 'UUID of the booking to cancel.',
        },
        idempotency_key: {
          type: 'string',
          description: 'Unique key to prevent duplicate cancellations (e.g. "cancel:<booking_id>:<message_id>").',
        },
      },
      required: ['booking_id', 'idempotency_key'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'escalate_to_human',
    description:
      'Hand the conversation off to a human staff member. ' +
      'Use when: the patient asks to speak to a human, the request is outside the allowed scope ' +
      '(medical questions, complaints, prescriptions), or you are unsure how to proceed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        conversation_id: {
          type: 'string',
          description: 'UUID of the conversation to escalate.',
        },
      },
      required: ['conversation_id'],
      additionalProperties: false,
    },
    strict: true,
  },
];

// ---------------------------------------------------------------------------
// Tool dispatcher — called after the model returns a tool_use block
// ---------------------------------------------------------------------------

export async function dispatchTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'clinic_day_info':
      return clinicDayInfo(input.date as string);

    case 'book_appointment':
      return bookAppointment(input.contact_id as string, input.clinic_date as string);

    case 'cancel_booking':
      return cancelBooking(input.booking_id as string, input.idempotency_key as string);

    case 'escalate_to_human':
      return escalateToHuman((input.conversation_id as string));

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
